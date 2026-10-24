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
