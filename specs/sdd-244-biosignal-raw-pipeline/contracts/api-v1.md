# SDD-244 API v1 (워커 A, T04~T06 구현 대상)

wrapper DTO 정본: `backend/app/schemas/biosignal.py` 하단 "T04 API wrapper" 섹션(G1 본문 DTO는 변경 없음, 확장만).
인증은 기존 eeg-raw와 동일: 로그인 JWT 또는 `X-Entry-Credential`, `participant_id`는 회원이면 생략 가능. 모든 `*_us`는 int64 10진 문자열.
기존 `/eeg-raw/presign|ack`(v1)는 그대로 유지한다(응답 형태 불변, signal=eeg·segment=legacy 전용).

| 메서드·경로 (`/api/v1/sessions/{session_id}` 하위) | 요청 → 응답 | 상태 |
|---|---|---|
| `POST /biosignal-raw/presign` | `PresignRequest` → `PresignResponse` | T04 |
| `POST /biosignal-raw/ack` | `AckRequest` → `AckResponse` | T04 |
| `POST /biosignal-artifacts/presign` | `ArtifactPresignRequest` → `ArtifactPresignResponse` | T05 |
| `POST /biosignal-artifacts/ack` | `ArtifactAckRequest` → `ArtifactAckResponse` | T05 |
| `POST /biosignal-events` | `EventsRequest`(gap·close_intent, ≤100) → `EventsResponse` | T06 |
| `GET /biosignal-capabilities?participant_id=` | → `CapabilityResponse` | T04 |
| `GET /biosignal-manifest?participant_id=&revision=` | → `ManifestResponse` | T06 |

## 규칙
- eeg-raw 형태 유지: 요청 `participant_id`·`play_group_id`·`chunks[]`, 응답 `chunks[{chunk_id, upload_status, checksum, size_bytes, ...}]` + `acked/failed/eeg_record_id/file_count`. v2는 `header: RawHeader`(identity=signal_type·stream_id·segment_id·chunk_index)와 `checksum`(SHA-256 hex, 업로드되는 전체 바이트)·`size_bytes`를 요청에 싣는다.
- **PUT**: 응답 `upload_url`에 `upload_headers`를 **그대로** 실어 PUT(SigV4로 `x-amz-checksum-sha256`·`x-amz-server-side-encryption`·`Content-Type` 서명됨). `upload_url=null`(이미 uploaded)이면 PUT 생략, ACK만 재요청.
- **멱등/충돌**: 같은 identity+같은 checksum은 같은 `chunk_id`/`object_key` 재사용. 같은 identity에 다른 checksum → **409** `{code:"chunk_identity_conflict", conflicts:[{signal_type,stream_id,segment_id,chunk_index,existing_checksum,attempted_checksum}]}`, 요청 전체 미반영(충돌 항목을 제외하고 재요청). 클라이언트는 충돌 payload를 dead_letter로 보관한다.
- **ACK**: 항목별 `upload_status`가 `uploaded`일 때만 성공(`verified_at_us` 포함). `failed`/`pending`은 `failure_reason`과 함께 payload 보관·재시도. ACK의 checksum/size_bytes는 presign 등록값과 일치해야 한다(불일치=failed). HTTP 200이어도 항목별 상태를 확인할 것.
- **object key**: `biosignal-raw/{session}/{participant}/{stream}/{segment}/{signal}/{chunk_index:08d}-{sha256}.bin`. artifact는 `biosignal-artifacts/{session}/{participant}/{kind}/...-{sha256}.bin`.
- 제한: 요청 chunks ≤100, 객체 ≤1MiB(1,048,576B), header ≤64KiB.
- `signal_type`별 v1 연동: v1 `eeg-raw`는 v2 청크를 조회·갱신하지 않으며 `EEGRecord.file_count`는 `signal_type=eeg` 업로드분만 센다.
- 구버전 서버는 위 경로가 404 → 클라이언트는 `GET /biosignal-capabilities` 404/`raw_schemas`에 `mb-biosignal-raw-v2` 없음이면 v2를 쓰지 않고 v1 경로만 쓴다.
- artifact `kind=indices`는 ACK 시 서버가 객체(JSONL, `DisplaySnapshot` 행)를 검증·파싱해 1Hz 검색 원장에 반영하고 `indexed_rows`로 알린다. `kind=normalization`은 `NormalizationSnapshot`(params_hash 기준 content-addressed 등록).
- 종료: `POST /biosignal-events`에 `close_intent`를 싣는다. `expected_artifacts`는 presign이 돌려준 `chunk_id`/`artifact_id`+sha256 전체 목록(raw·feature·raw_derived·indices·normalization·algorithm), gap 마지막 sequence 포함. 응답 `close_state`가 `complete`일 때만 완료; 미확인 항목은 `missing_artifacts`. 후발 ACK는 새 manifest revision을 만든다.

## alias ↔ UUID 규칙 (B 요청 반영)
- **클라이언트가 alias 문자열을 만든다**(`^[A-Z][A-Za-z0-9_-]{0,63}$`, 예: `RAW-EEG-<stream8>-<seg8>-000012`). raw 청크는 `PresignChunk.chunk_alias`, 그 외 산출물은 `ArtifactPresignChunk.artifact_alias`로 presign 때 보낸다. 회차·참여자 안에서 유일하며 같은 alias+같은 내용은 멱등(같은 UUID 반환), 같은 alias에 다른 내용/identity는 409 `alias_conflict`.
- 서버는 presign/ACK 응답에 `chunk_alias`↔`chunk_id`, `artifact_alias`↔`artifact_id`를 항상 되돌려준다(UUID는 서버 내부 원장 키, 객체 안에는 쓰지 않는다).
- **객체(JSONL/raw header) 안에는 alias만 쓴다.** `SourceWindow.raw_artifact_id_alias` = raw `chunk_alias`, `DerivedReference.artifact_id_alias` = raw_derived `artifact_alias`. 참조 대상이 아직 업로드되지 않았어도 alias는 미리 확정할 수 있다(같은 alias로 나중에 presign).
- `DisplayMetric.source_feature_id` = `FeatureRecord.feature_id_alias`. feature 객체 presign 때 `feature_id_aliases[]`로 그 묶음에 든 feature_id_alias를 알리면 서버가 `feature_id_alias → artifact_id` 색인을 만든다(객체를 파싱하지 않음). 서버가 저장 시 UUID/artifact로 해석하며 해석 불가 alias는 manifest에 `unresolved_reference`로 남고 close intent가 `complete`가 되지 않는다.
- close intent `expected_artifacts[]`는 `{kind, alias, sha256}`로 alias를 쓴다(UUID 불필요). `missing_artifacts`도 alias로 돌려준다.
- 공개 manifest(`ManifestRevision`)의 `artifact_id_alias`는 업로드 alias와 같은 문자열을 쓰되 사용자/UUID/object key는 포함하지 않는다.

## 구현 확정 사항 (T04~T06, 워커 A)
- **409 코드**: `chunk_identity_conflict`(raw identity에 다른 checksum), `artifact_conflict`(artifact 슬롯 `kind+stream+segment+signal+view+sequence`에 다른 checksum), `alias_conflict`(alias가 다른 슬롯/다른 종류가 이미 사용). 충돌 요청은 전체 미반영.
- **alias 규칙**: raw `chunk_alias`와 artifact `artifact_alias`는 같은 회차·참여자 안에서 서로 겹치지 않는다. 서버 합성용 예약어(`GAPS`, `RAWMISSING-*`, `FEATMISSING-*`, `IDXMISSING-*`, `GAPMISSING-*`, `GAPUNEXPECTED`)는 422.
- **artifact 필수 scope**: `feature`/`raw_derived`=`signal`+`segment_id`+`stream_id`, `indices`=`stream_id`+`view_instance_id`, `normalization`/`algorithm`=없음. `feature_id_aliases`는 `feature`만. `indices`/`normalization` ACK는 객체(JSONL, gzip이면 `uncompressed_sha256` 일치)를 검증·해석하며 계약 위반·행수 불일치면 `failed`(`content_schema_invalid`/`row_count_mismatch`)로 남고 색인하지 않는다. 색인 실패한 객체도 서버에 남지만 `uploaded`로 보지 않는다 → 클라이언트는 payload를 보관하고 수정 후 같은 슬롯에 재업로드할 수 없으므로(내용 주소) 새 sequence로 올리거나 `lost_artifacts`로 선언한다.
- **events**: gap은 `event_id` 멱등(동일 내용 `duplicate`, 다른 내용 `conflict`), `sequence`는 회차·참여자 안에서 유일(재사용 `conflict`/`sequence_already_used`). close intent는 `intent_id` 멱등. 판정은 **가장 최근 `closed_at_us`의 intent** 기준이다.
- **`CloseIntentIn.lost_artifacts[{kind, alias, reason}]`**(선택): 회복 불가로 선언한 산출물. 필수 목록에서 제외되고 `partial` 판정 근거가 된다(manifest에는 `availability=lost`+사유).
- **close_state 판정**: intent 없음=`unknown`. intent 있음 → ①`expected_artifacts` 항목 중 미등록/미검증/sha 불일치, ②intent 밖 업로드 항목, ③`last_chunk_sequence`/`last_feature_sequence`/`last_snapshot_sequence`/`last_gap_sequence` 구멍, ④indices가 참조한 `source_feature_id` 미해석 중 하나라도 있으면 `pending_upload`(목록은 `missing_artifacts`, 구멍·합성 항목의 sha256은 전부 0 = 알 수 없음). 모두 해소되고 선언된 loss가 있으면 `partial`, 없으면 `complete`. intent 이후 새 산출물을 올리면 새 close intent(새 `intent_id`)를 보내야 한다.
- **manifest revision**: 판정 결과(공개 DTO)가 달라질 때만 새 revision. 같은 상태 재판정은 revision을 늘리지 않는다. raw/artifact ACK·gap·close intent 수신마다 재판정하며 이미 쓴 revision 행은 DB 트리거로 수정 불가. `GET /biosignal-manifest`는 최신 포인터 또는 `revision` 지정본을 돌려주며 인가는 본인 참여자(입장 자격/로그인)이다. 공개 manifest의 session/participant/stream/segment/intent/view alias는 서버 HMAC 또는 순번 alias이고 UUID·object key는 없다. 정책(동의·철회·만료·정확시각)은 `policy_recheck_required=true`이므로 반출 시 재검사한다. `raw_packet_policy`는 보수적으로 `blocked_requires_redaction`(243이 권한 확인 후 결정).
- **manifest artifact 목록**: close intent의 expected 항목(+서버 합성 `GAPS`: gap 이벤트 정규 JSONL, intent의 `last_gap_sequence` 이하)만 담긴다. path는 `raw/{signal}/stream-S01/segment-001/chunk-000000.bin` 및 `{kind}/{alias}.bin`이며 ZIP 내 최종 배치는 243/C adapter가 정한다. `signals[].expected_samples`는 intent의 `received_samples` 합(수신 전 BLE 손실은 gap/coverage로 표현), `acked_samples`는 검증 ACK된 raw의 `sample_count` 합이다.
- **capability**: `GET /biosignal-capabilities`의 신호별 `research_consent`는 EEG만 기존 연구 동의(`consented/not_consented/withdrawn`)를 반영하고 PPG/ACC는 신호별 연구 동의 범위가 아직 정의되지 않아 `unknown`(`signal_scope_consent_not_defined`)이다 — 기존 동의를 자동 확장하지 않는다.
