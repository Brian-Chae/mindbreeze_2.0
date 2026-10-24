# SDD-244 — 생체신호 전체 저장 파이프라인 구현 계획

> 원 계획 작성 시점(29c62915)의 실행 안내: 구현을 별도 승인받은 뒤 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`로 Task별 RED → 구현 → 검증 → 독립 리뷰를 수행한다. 이번 산출물은 Stage ② Plan + Stage ③ Verify뿐이며 구현을 시작하지 않는다.

- **T02 실행 갱신(2026-10-24): Brian 승인 후 T02/G1만 완료. 아래 원 계획의 “이번 문서 작업/미실행”은 작성 당시 기록이며, 현재 T02 결과와 검증 범위는 §7을 우선한다. T01·T03 이후는 미실행이다.**

- 작성: 2026-10-24. 기준: `c5897f27`, `sdd/244-biosignal-raw-pipeline`.
- 목표: 웹의 EEG·PPG·ACC 수신 원문, 전체 feature, 당시 화면 6지표를 복원 가능한 계약으로 보존하고 SDD-243의 MB 원본 ZIP에 공급한다.
- 아키텍처: 기존 presign/PUT/ACK 서비스와 영속 큐를 확장한다. 수집 원본·분석 결과·표시 스냅샷을 분리하고 회차 manifest revision으로 완전성·정책·반출 범위를 연결한다.
- 기술: 기존 React/TypeScript·IndexedDB·FastAPI/SQLAlchemy·PostgreSQL·S3 호환 객체 저장소. 새 브로커나 분석 서버는 도입하지 않는다.
- 입력: [spec.md](spec.md), [MB 조사](research/01-mindbreeze.md), [HARU 조사](research/02-haru-band.md), [SDK 조사](research/03-linkband-sdk.md). 조사 결과는 정적 근거이며 운영·실기기 성공 증거가 아니다.

## 1. 확정 범위와 선행 게이트

2026-10-24 Brian 확정 사항이 spec §7의 미결 질문보다 우선한다. spec 원문은 이 작업에서 수정하지 않는다.

1. P0 ACK 유실은 `fix/eeg-raw-ack-loss`가 먼저 수정한다. **검증 ACK 후 삭제·실패 영속 보관·enqueue 실패 보존** 결과를 재사용한다. SDD-244에서 같은 버그를 별도 재구현하지 않는다.
2. **웹 먼저** 수집·서버·MB ZIP 인수. iOS/Android는 별도 단계 W5에서 새 bundle과 각 실기기 검증을 마친 지원 프로필만 확대한다. 웹 통과가 앱 통과를 뜻하지 않는다.
3. **MB 원본 ZIP 우선**. SDK export profile 구현·SDK 파일 오류 재현·HARU 알고리즘 일괄 이식은 범위 밖이다. 샘플행 Parquet 디코딩 계약은 SDD-243 소비를 위해 유지한다.
4. 제품 코드·마이그레이션 생성/실행·서버/DB/.env 접근·삭제·메일·머지·배포는 이번 작업 범위 밖이다. 아래 Task/경로는 미래 구현 계획이다. 모든 구현·실행 체크박스는 미실행 상태다.
5. 기존 `eeg-raw-v1`, 기존 feature 27개 의미, 동의/업로드 권한, 밴드 선택 사용, 서사·변화량 리포트를 유지한다. 과거 PPG/ACC·당시 표시값을 소급 생성하지 않는다.

### FIX 인수 경계

- T01은 FIX의 최종 commit·변경 목록·회귀 증거를 기록하는 선행 게이트다. 현재 FIX 완료/통합을 주장하지 않는다. FIX 결과의 소비는 향후 구현 브랜치에서 수행하며 이번 문서 작업에서는 병합하지 않는다.
- 충돌 후보: `frontend/src/hooks/useEegRawUpload.ts`, `frontend/src/hooks/useBand.ts`, `frontend/src/lib/session-live/raw-chunk-queue.ts`, `frontend/src/lib/api/eeg-raw.ts`, `frontend/tests/use-eeg-raw-upload.test.tsx`, `frontend/tests/sdd222-raw-upload-resume.test.tsx`; BE의 `backend/app/services/eeg_raw_service.py`, `backend/app/services/storage_service.py`, `backend/app/schemas/eeg.py`도 FIX 실제 diff 확인 대상이다.
- FIX가 위 파일을 소유하는 동안 해당 파일 변경 Task T04/T07/T08은 시작하지 않는다. 독립 계약·디코더·fixture T02/T03은 가능하다. FIX 회귀가 실패하면 FIX 담당에 반환하며 244에서 우회 수정하지 않는다.
- checksum 검증·불변성·세 신호 DTO 등 **확장분**은 T04/T08 담당. FIX에 이미 구현된 항목은 테스트로 재사용하고 중복 코드를 만들지 않는다.

## 2. 수집·저장 아키텍처

```text
BLE DataView 원문 복사
 → 100ms 이하 로컬 packet journal 트랜잭션
 → 신호별 parser/clock profile → 불변 raw 청크(10초 또는 1MiB)
 → 기존 presign → PUT → 서버 해시/크기/원장 검증 ACK
 → 로컬 ACK 영속 기록 → 해당 payload GC
         ├─ 분석 결과 발생별 feature outbox → JSONL 객체/검색 스칼라
         ├─ 실제 표시 snapshot 1Hz → indices outbox
         └─ gap + close intent → manifest revision
서버 decoder + manifest + dictionary → SDD-243 인가/작업/MB ZIP
```

### 2.1 식별·청크·직렬화 v2

- `signal_type=eeg|ppg|acc`와 수집 실행 UUID `stream_id`, 재접속/clock reset/profile 변경 UUID `segment_id`를 구분한다. 회차=`session_id`, 반복 재생=`play_group_id`(nullable). 사용자/참여자는 서버에서 인가하며 클라이언트 입력을 신뢰하지 않는다.
- 유일키 `(session_id,participant_id,signal_type,stream_id,segment_id,chunk_index)`. 각 신호/segment index는 0부터 증가하고 로컬 index 할당·payload 등록을 한 트랜잭션으로 묶는다. 같은 키·같은 hash/size는 멱등, 다른 payload는409이며 두 payload 모두 조사 가능하게 보존한다.
- v2 객체 key는 `biosignal-raw/{session}/{participant}/{stream}/{segment}/{signal}/{chunk_index}-{sha256}.bin`. 기존 v1 key/바이트는 유지한다. 재시도는 내용 주소에 같은 바이트만 PUT, ACK된 객체의 다른 바이트 재PUT 금지. upload 권한은 회차 참여 본인/유효 entry credential·해당 동의 범위로 제한한다.
- **컨테이너 `mb-biosignal-raw-v2`**: offset0 ASCII `MBRAW002` 8B, offset8 `uint32 LE` UTF-8 JSON header 길이, offset12부터 header, 이어서 section bytes. 패딩 없음. header의 section offset은 body 시작 기준이며 길이/중첩/범위/row stride를 검증한다. header ≤64KiB, 전체 ≤1MiB, SHA-256은 파일 전체 바이트. schema 미지원/길이 불일치/NaN·Inf는 명시 오류다.
- header 필수: schema/signal/stream/segment/chunk_index, parser profile/hash, rate numerator/denominator, channels/units/scale, sample_count/packet_count, sample range, time_basis/anchor, sections `{name,offset,length,row_stride,encoding}`. 전송 메타의 hash와 header를 중복 대조한다. 서버 내부 ID는 export 시 별도 가명화한다.
- sample section은 LE 고정 stride: EEG `int32 ch1_adc,int32 ch2_adc,uint8 lead_off,float32 fp1_uv,float32 fp2_uv`=17B(패딩 없음), PPG `uint32 red,uint32 ir`=8B, ACC `int16 x_raw,y_raw,z_raw,float32 x_g,y_g,z_g`=18B. signed24 EEG는 int32에 부호 확장. ADC 정수/lead-off가 정본이며 float32는 당시 변환값이다.
- packet section은 수신 원문을 길이순으로 연결한다. packet-map section은 UTF-8 JSONL: packet_seq, byte_offset/length, first_sample_index/count, tick raw/unwrapped, received UTC/monotonic µs, header_anchor, clock_segment_id, malformed reason. unknown/잘린 패킷도 원문과 원인을 남기며 가짜 샘플을 만들지 않는다.
- decoder는 원 ADC→물리량과 저장 float32를 대조하고 packet/sample 대응을 제공한다. 청크 분할은 패킷 경계 우선, 합계 크기 상한에 앞서 봉인한다. 단일 비정상 패킷이 상한 초과하면 별도 제한 오류와 loss 이벤트로 기록하고 수집 중단한다. 배열 waveform은 raw와 별도의 `raw-derived` 객체이며 동일90일 정책이다.

### 2.2 영속 큐·업로드 API

- 기존 FIX의 큐/상태 머신을 확장 재사용한다. IndexedDB에 packets, next_indices, sealed_chunks, feature_outbox, indices_outbox, gaps, close_intents, leases, ack_receipts 저장소를 additive version upgrade한다. 기존 pending_raw_chunks를 삭제하거나 v2로 추정 변환하지 않는다. upgrade 차단 탭은 재시작 안내; legacy 큐는 legacy uploader로 drain한다.
- 수신 콜백에서 DataView를 즉시 복사하고 journal 성공 전 메모리 제거 금지. 분석 busy 경로 이전에 수집한다. 100ms는 목표이며 강제 종료·suspend·quota에서는 보장하지 않는다. heartbeat의 마지막 영속시각 이후 unknown tail을 남긴다.
- lease 키=`account+session+participant+device alias`; IndexedDB 트랜잭션의 owner/fencing token과 만료로 탭 단일 수집을 보장한다. TTL 10초/갱신2초, token 유효성은 append마다 검사. lease를 잃은 탭은 중단, 인계는 새 stream. 로그아웃은 중단/큐 잠금, 다른 계정으로 재전송 금지. 키에 실제 장치 ID를 반출하지 않는다.
- `pending → uploading → awaiting_ack → acked`; 오류는 retry_wait/blocked/durable dead_letter. 8회 초과·403·409·동의 철회는 상태와 사유를 보존하며 재시도 횟수로 삭제하지 않는다. 동의 철회 payload 처리는 별도 정책 삭제 경로다.
- 기존 세션 하위 EEG presign/ack 라우트를 유지하고 `POST /sessions/{session_id}/biosignal-raw/presign`, `/ack`를 같은 서비스의 어댑터로 추가한다. 요청 chunks≤100, 각 메타는 v2 identity/hash/size/sample/time/profile 포함. ACK 응답은 항목별 `chunk_id,checksum,size_bytes,status,verified_at`; status=uploaded만 성공이다.
- **불변 객체 확정:** primary 경로는 SHA-256 checksum을 presigned 요청의 서명헤더에 바인딩하고 저장소가 실제 body checksum을 강제 검증하는 구성을 요구한다. 유효 URL을 다시 써도 다른 바이트는 거절되어야 한다. 이 기능이 없는 S3 호환 저장소는 client PUT을 attempt별 staging key에만 허용하고, 서버가 검증한 bytes를 client URL이 없는 final key로 publish한다. final publish는 DB identity lock과 create-only 동작으로 단일화하고 object version ID를 원장/manifest에 고정한다. 조건부 생성/버전 고정 어느 것도 보장 못 하면 해당 저장소 v2 활성화를 차단한다. staging URL·unversioned GET을 immutable final 원본처럼 소비하지 않는다. ACK 후 기존 URL의 다른 payload PUT 시험이 필수다. staging 삭제는 보관 정책 작업으로 분리하며 이번 실행 범위가 아니다.
- presign 반환 headers를 그대로 PUT한다. 객체 HEAD 존재/크기와 저장소 SHA-256 또는 서버 streaming read SHA-256, DB commit 모두 성공해야 uploaded. HEAD 불가·검증 불가·DB rollback은 실패/재시도. ETag는 SHA-256이 아니다. 미ACK 항목만 재전송하고 검증 ACK의 ID/hash/size 일치 후 receipt를 영속화한 다음 GC한다.
- feature/indices/raw-derived 객체도 같은 검증 업로드 내부 서비스를 재사용하되 `artifact_kind`로 구분한다. raw의 signal enum에 feature/indices를 끼워 넣지 않는다. `POST /sessions/{id}/biosignal-artifacts/presign|ack` 어댑터와 `/biosignal-events`(gap/close intent 멱등 배치, 최대100건)를 제공한다.
- 네트워크 업로드 동시성2, 한 객체10초 또는1MiB, exponential backoff/만료 URL 갱신은 기존 클라이언트를 재사용한다. quota 80% 경고,95% 또는 예상2분 수신량 미만이면 안전 중단; 경고 후 계속 삭제해 공간을 만들지 않는다. 추정 quota가 없으면 실제 쓰기 실패 즉시 중단한다. 미영속 메모리 상한8MiB 도달 시에도 중단/loss 기록한다.

### 2.3 시각·gap·회차 manifest

- 내부 UTC µs·monotonic µs는 정수, JSON의 int64는 10진 문자열로 표현한다. sample index와 rate 유리수로 `anchor+(i-(N-1))*1e6/fs` 재구성, 최종 출력 때만 반올림한다. µs 표현은 µs 정확도 주장이 아니다.
- MB 웹 초기 profile은 EEG/PPG/ACC 250/50/30Hz, tick32768, 마지막 샘플 anchor라는 **검증 전 가정**이다. 현 ACC 연속 배치/재앵커링과 새 저장 시간축을 별도 version으로 구분한다. 실기기 검증 전 `host_estimated`; 불확실한 native는 `device_relative`이며 임의 UTC 승격 금지.
- wrap은 단조 tick과 경과를 함께 확인, reset/벽시계 점프/재앵커링/프로필 변경은 새 clock segment. 원 tick·원 arrival은 불변, 보정시각과 오차는 version 있는 파생 필드다. packet_seq는 호스트 순번이므로 장치 loss의 단독 근거가 아니다.
- gap `{event_id,signal,stream,segment,start_us,end_us,reason,observed_or_estimated,expected_samples,received_samples,reconnect_count}`. BLE 단절·packet gap·local write failure·process termination·unknown과 upload pending을 구분한다. unknown 손실 수는 null. gap도 영속 outbox/멱등 수신; raw 보간/중복 삭제 금지.
- close intent는 stream별 마지막 chunk/feature/snapshot sequence, 실제 수신 샘플수, 종료 사유와 **전체 expected artifact set의 ID/hash**를 로컬에 먼저 기록한다. 목록은 raw·상세 feature·raw-derived 파형·indices·normalization/algorithm parameter snapshot 및 gap 이벤트 마지막 sequence까지 포함하며 각 참조의 수신/commit 또는 검증 ACK를 서버가 확인한다. shared model snapshot도 hash로 등록/commit된 것이 확인돼야 한다. 서버는 이 목록을 ACK 원장과 대조한다. raw-derived·model·gap 하나라도 미확정이면 complete 금지다. 종료 오프라인은 pending_upload, 회복 불가/명시 종료 손실은 partial, 기대 항목 전부 검증 수신은 complete. close intent 없는 종료는 기대량 unknown이며 complete 금지.
- `complete`는 수신 자료의 전달 완료다. `coverage`의 BLE gap/unknown tail/미착용을 숨기지 않는다. 후발 ACK는 새 immutable revision, 최신 revision 포인터만 갱신한다. export는 지정 revision을 pin한다. 종료 API 응답을 저장 완료로 대신하지 않는다.

### 2.4 feature와 1Hz 표시값

- **상세 feature는 처리기가 결과를 실제 emit할 때마다 전부 보존**한다. EEG 약1Hz, PPG 패킷별, ACC 실제 emit 주기를 계측하며 1Hz로 강제 downsample하지 않는다. 중첩 창도 feature_id/sequence로 구분한다. 전체 필드 inventory를 fixture에 고정하며 새 필드 미반영은 테스트 실패다.
- JSONL 객체는 10초/1MiB 묶음 gzip(`.jsonl.gz`, 압축·원문 각각 hash), EEG/PPG/ACC 복합 결과와 source window/ranges·알고리즘 version/parameters hash·valid sample count·computed_at·quality를 저장한다. 원본 배열 dedup은 content hash 참조로 정확히 복원 가능한 경우에만 허용한다.
- PSD/frequency·채널 band power·SQI 요약·RR/peak/beat ID·채택/제외·ACC 통계는 feature 객체. filtered waveform·샘플별 mask·raw 복제 배열은 raw-derived 객체로 분리하고 feature에는 object/hash/range 참조만 저장한다. 만료 시 expired 참조로 남겨 파형 보관 우회 금지.
- 기존 DB feature 스칼라는 활성 수집 기준1Hz(동일 초 latest computed 결과, signal별 원천 feature ID 유지). 기존 window_index/play_group 멱등 계약을 유지하면서 `total_neural_activity,faa,play_group_id` 누락을 연결한다. 저장 빈도와 분석 빈도는 별개이며 JSONL은 모든 emit을 포함한다.
- 화면은 렌더에 사용하는 **동일 DisplaySnapshot 객체**를 화면별1Hz 저장한다. key=`stream+view_instance+second_index`; displayed_at·measured_at·source_feature_id, 마음3 입력/정규화 출력/표시 정수, BPM·호흡·SDNN 입력/표시 정수, held/stale/lead_off/quality/null reason/remote fallback를 보존한다. 여러 화면은 view_kind별로 구분하고 export 기본 화면은 participant player, 없으면 session player, 선택값을 meta에 명시한다.
- 탭 비활성/OS 타이머 지연 초는 null+not_rendered/gap, 실제 렌더되지 않은 값을 표시값으로 만들지 않는다. 활성 상태 null 초도 저장한다. 기존 UI 5분 막대/모바일 현재값 정책과 종합점수 금지를 유지한다.
- normalization model ID/version·지표별 `{m,s,direction}`·공식상수·hash·B0 version/사유·filter/algorithm/display pipeline version·build를 content-addressed snapshot으로 저장한다. 모델 변경은 새 snapshot; 오래된 기록에 최신 모델 적용 금지. HRV는 **SDNN(ms)**, RMSSD 별도; 감정균형은 정규화 emotional_stability다.
- 호흡은 MB 기존 알고리즘의60초 gate와 유효값/null reason을 기록한다. RR overlap·경과 gate·LF/HF 단위·SQI에 의한 시간 압축은 T10의 독립 fixture로 재현하고 재현된 결함만 새 algorithm version으로 수정한다. HARU 수치 동일성/생리학적 정확도는 수집 완료 기준이 아니다.

### 2.5 보관·연구 확장

- SDD-238 기준 `(ended_at ?? created_at) + 90일`, completed/cancelled 비템플릿·기존 적용하한 사용. ACK일+90일로 연장하지 않는다. raw/packet/raw-derived·export 임시 사본을 같은 정책으로 처리한다.
- 신호별 유효 연구동의가 있고 해당 범주/manifest revision/hash 이관 미ACK이면 그 원본만 보류. EEG ACK가 PPG/ACC 또는 파형/indices 이관 성공을 뜻하지 않는다. 미동의 신호는 반출 차단·연구 보류 비대상. 기존 연구 consent.export_state 전체값만으로 삭제 판단 금지.
- SDD-241 연구 bundle v3에 신호별 raw·feature·indices·gap·stream/segment·모델/알고리즘·scope/hash/revision을 추가한다. 기존 v2 배치/ACK는 기존 범주에만 유효. 수신자가 v3 capability를 수용하지 않으면 pending이며 가짜 ACK 금지. 범위 승인 없는 r5-2 동의를 자동 확장하지 않는다.
- 연구 사본의 장기 보관 정책은 서비스 원본90일 및 일반 다운로드 기한과 분리한다. 철회 전이/반출 차단을 매 생성·URL 발급·ACK 시 재검사한다. 가명화된 연구 사본에서도 원 UUID/벽시계/tick 유출을 검사한다.
- 삭제 대상 결정→원장 tombstone/삭제 outbox commit→객체 삭제 재시도→완료 기록. 객체 실패를 DB 성공으로 감추지 않는다. tombstone은 payload/재식별 값을 담지 않는다. 통합 sweep을 확장하고 legacy sweep과 이중 실행하지 않는다. 이번에는 설정 변경·dry-run·삭제를 전혀 수행하지 않는다.

## 3. SDD-243 소비 계약과 병렬 시작

### G1 계약 동결(T02 종료)

T02에서 typed DTO는 `backend/app/schemas/biosignal.py`에 먼저 정의하며 뒤 Task는 이 타입을 확장 없이 소비한다. T02의 아래 파일/fixture를 BE·FE와 SDD-243 소비자가 정적 리뷰한 commit을 **G1 계약 확정 commit**으로 기록한다. 원 계획 당시에는 설계안이었으며, T02 실행 후 G1 계약 확정 commit과 소비자 관점 리뷰를 §7에 기록했다. G1부터 SDD-243 UI·조회·인가·ZIP 개발은 fixture 기반으로 병렬 시작 가능하다. 실제 웹 데이터 인수는 W4 뒤, 앱 표시는 W5에서 해당 플랫폼 통과 뒤다. spec §5의 앱 검증 의존을 웹 출시 차단으로 확대하지 않는다.

- 생성 예정: `specs/sdd-244-biosignal-raw-pipeline/contracts/{raw-v2.schema.json,manifest-v1.schema.json,feature-v1.schema.json,indices-v1.schema.json,field-dictionary-v1.json}` 및 `contracts/fixtures/`의 합성 bytes·기대 sample/CSV/manifest/error. T02 소유자는 A 한 명, 다른 워커는 읽기 전용.
- Python 인터페이스(C 소유): `decode_raw_chunk(payload: bytes, metadata: RawChunkMeta) -> Iterator[DecodedSample]`; v1/v2 dispatch·unsupported schema 명시, full object hash 검증 후 row iterator, `DecodedSample`은 ADC/물리량/lead-off/sample/packet/time 근거를 보존한다.
- `iter_export_artifacts(manifest: ManifestRevision, selection: ExportSelection, policy: ExportPolicy) -> Iterator[ExportArtifact]`; bytes/row iterator·relative path·schema·dictionary key·row_count/time range·hash·availability 반환. 저장소 읽기는 injected reader, ZIP 생성·권한 판정은 SDD-243 책임이다. reader도 policy 범위 밖 자료 반환 금지.
- `get_manifest(session_id, participant_id, revision) -> ManifestRevision`(A 소유)은 ACK된 raw/artifact 목록과 coverage·미수집/expired/withdrawn/lost/unknown 사유를 제공한다. 조회 시 정책 상태는 재검사하며 불변 revision이 철회 우회권을 주지 않는다.
- manifest 공통: schema_version/revision/close_state, session/participant alias, streams/segments/profiles/rate/units/time_basis, expected/acked/lost/unknown counts, gaps, models/algorithms, 파일별 path/schema/rows/bytes/SHA-256/time range/selection/retention/availability. 내부 object key와 원 UUID는 내부 DTO 전용, public DTO에서 whitelist 변환한다.
- dictionary의 필드마다 name/type/unit/nullable/null_reason/source_metric/source_layer/precision/time_basis/schema_version/algorithm_version을 정의한다. feature 기존27개 + 키는 spec §4 그대로, indices 이름도 그대로 유지한다. JSON int64 문자열·CSV null 빈칸·JSON null·float32 round-trip(유효숫자9자리)·NaN/Inf 거부를 fixture로 고정한다.
- 샘플 CSV: EEG `timestamp,fp1,fp2`, PPG `timestamp,red,ir`, ACC `timestamp,x,y,z`. 기본 timestamp는 회차 공통 상대 초, t_rel_ms는 같은 기준의 ms. 정확시각 인가 때만 UTC ISO8601 Z; UI KST와 구분. `[from,to)`로 CSV/Parquet 샘플 선택, bin은 겹치는 청크 전체와 extra range 표시.
- MB ZIP 경로는 spec §4의 회차/참여자/신호 폴더, raw bin·packet·sample-map·feature JSONL·raw-derived·display-status를 포함한다. 내부 v2 컨테이너 원문과 분리 packet bytes는 무손실 제공 권한일 때만 제공; tick/UUID를 가명화해야 하면 원문 bin 차단+`redacted_packet_view`를 별도 제공하며 서버 정본은 변경하지 않는다.
- SDD-243는 루트 README/dictionary/manifest와 각 part 메타, 1GB=1,000,000,000B 최종 ZIP 상한·단독 열림·중첩 ZIP 금지·가명/기관/목적 권한/감사/만료를 소유한다. 244 C는 ZIP을 새로 만들지 않고 decoder/artifact adapter와 합동 계약 테스트를 공급한다. SDK 변환 profile은 이번 계약·Task에 포함하지 않는다.

## 4. Additive 마이그레이션 목록(A 단독 소유)

실제 revision ID/down_revision은 구현 시 최신 통합 head를 확인해 발급한다. 현재 숫자를 임의 선점하지 않는다. 아래 `<revision>`은 미래 Alembic 파일명 자리표시자다. 세 파일은 직렬 체인이며 SDD-243 migration과 병합 직전 단일 head를 확인한다.

| 순서/예정 파일 | 추가·변경 | 레거시/무결성 |
|---|---|---|
| M1 `backend/alembic/versions/<revision>_sdd244_raw_streams.py` | 기존 eeg_raw_chunks에 signal_type(default eeg), segment_id, profile/schema metadata, sample/packet counts·time basis; biosignal_streams/segments, gap_events, manifest_revisions·current pointer | legacy segment='legacy', 기존 key/바이트 유지, unique 키를 새 identity로 확장하되 v1 동시요청 기존 의미 유지. v2 participant는 필수, nullable legacy 행은 별도 부분 unique/조회 분기로 보존. CHECK signal/count/range, FK 및 participant/stream 조회 인덱스 |
| M2 `backend/alembic/versions/<revision>_sdd244_artifacts_indices.py` | biosignal_artifacts(kind/retention class/hash/ACK/window/sequence), display_snapshots(1Hz·view), normalization_snapshots(hash unique), eeg_feature_windows에 source feature refs·algorithm version nullable 추가 | 기존27컬럼 변경 없음. snapshot key unique, manifest/artifact 참조. 큰 배열은 DB JSONB에 복제하지 않음 |
| M3 `backend/alembic/versions/<revision>_sdd244_research_retention.py` | research_signal_receipts(consent/signal/artifact kind/manifest revision/hash unique), object_deletion_outbox·상태/재시도/tombstone; 연구 item schema/version·scope 명시 | 과거 EEG ACK를 PPG/ACC에 backfill 금지. feature 장기보관과 raw-equivalent90일 구별. 기존 export_state 호환 유지 |

- 신규 metadata만 nullable/default로 추가 후 작은 배치 backfill, 큰 테이블 rewrite/장시간 잠금을 PG에서 계측한다. v1 `schema_version=1.0`은 내용 검증 없이는 `eeg-raw-v1`로 재명명하지 않는다.
- 기존 EEG용 조회·연구 v2·legacy retention·EEGRecord.file_count는 명시적으로 signal_type=eeg만 집계하고 v2 payload를 v1 decoder에 전달하지 않는다. legacy 라우트는 segment=legacy를 기본으로 하며 실제 v2 소비는 capability/schema 분기를 거친다. PPG/ACC 행이 EEG float32로 해석되지 않는 회귀를 추가한다.
- 구 서버/신 서버 읽기, 구 앱 upload, 기존 partial unique index·null play_group 동작을 PG 검증한다. 삭제 CASCADE로 연구 증거/원본이 사라지지 않게 receipt에는 기존 연구 원장 정책을 따른다.
- rollout: 서버 dual read/write 수용 → 웹 capability cohort → 웹 검증 → 앱별 검증/확대. rollback은 신규 capability 비활성·기존 수집 경로 유지, v2 읽기 유지. 자동 downgrade/컬럼·객체 삭제는 하지 않는다.

## 5. 워커 소유권과 Task(각 2~5시간 추정)

**3개 분리 워크트리 권장**: A 서버 수집/DB, B FE 전체, C 디코더/연구/retention·독립 검증. 같은 워크트리 병렬 수정 금지. 2명일 때 A+C를 한 워커가 순차 수행하고 B는 별도 워크트리에서 진행한다. 아래 시간은 실행·리뷰 포함 작업량 추정이며 완료 약속이 아니다.

### 경로 소유권(추가 경로는 소유자 확정 후 사용)

| 소유자 | 유일한 수정 경로 |
|---|---|
| A | `backend/alembic/versions/*sdd244*.py`, `backend/app/models/{record,eeg_feature,research_export,__init__}.py`, 신규 `backend/app/models/biosignal.py`, `backend/app/schemas/{eeg,session}.py`, 신규 `backend/app/schemas/biosignal.py`, `backend/app/api/v1/session.py`, `backend/app/services/{eeg_raw_service,storage_service,session_service}.py`, 신규 `backend/app/services/biosignal_service.py`, `backend/app/ws/session_live_namespace.py`, `backend/tests/test_sdd244_ingest.py`, `backend/tests/pg/test_sdd244_schema.py`, `backend/tests/pg/test_sdd244_ingest.py`, `specs/sdd-244-biosignal-raw-pipeline/contracts/**` |
| B | `frontend/src/hooks/{useBand,useEegRawUpload}.ts`, 신규 `frontend/src/hooks/useBiosignalCapture.ts`, `frontend/src/lib/api/eeg-raw.ts`, 신규 `frontend/src/lib/api/biosignal.ts`, `frontend/src/lib/session-live/{raw-chunk-queue,raw-encoder,feature-queue,metric-display}.ts`, 신규 `frontend/src/lib/biosignal/**`, `frontend/src/lib/eeg/{blePacketParser,TimestampSynchronizer,StreamProcessor,EEGSignalProcessor,PPGSignalProcessor,ACCSignalProcessor,AnalysisMetricsService,eegPersonalScore}.ts`, `frontend/src/lib/eeg/bluetoothService.ts`, `frontend/src/components/class/player/member/{MemberClassContainer,MemberStage,MemberSheets}.tsx`, `frontend/src/pages/sessions/ClassPlayerPage.tsx`, `frontend/src/lib/ble/capacitor-ble-adapter.ts`, `frontend/tests/sdd244-*`, 기존 `frontend/tests/{use-eeg-raw-upload.test.tsx,sdd222-raw-upload-resume.test.tsx}` |
| C | 신규 `backend/app/services/biosignal_decoder.py`, `backend/app/services/biosignal_export_adapter.py`, `backend/app/services/{retention_sweep_service,research_export_service}.py`, `backend/app/tasks/eeg_raw_task.py`, `backend/app/api/v1/research_export.py`, `backend/tests/test_sdd244_decoder.py`, `backend/tests/test_sdd244_export_contract.py`, `backend/tests/test_sdd244_policy.py`, `backend/tests/pg/test_sdd244_policy.py`, 신규 `scripts/verify-sdd244-artifacts.py`, `scripts/measure-sdd244-capacity.py` |

A가 model/schema/migration을 모두 소유한다. C가 필요한 DB 변경은 A에게 계약으로 요청하고 직접 수정하지 않는다. B의 useBand·processor·표시 경로는 한 워커가 순차로 처리한다. SDD-243의 `export_package.py`, `export_service.py`, `api/v1/data_exports.py`, `schemas/data_export.py`와 데이터센터 FE는 243 소유이며 244 워커는 수정하지 않는다. 신규 router 등록은 기존 session.py 하위로 하여 공용 main.py 경쟁을 피한다. 앱 native 디렉터리/빌드 설정 변경은 W5에서 실제 필요를 확인한 뒤 별도 소유권 합의하며 현 계획은 새 플러그인 추가를 전제하지 않는다.

### Task 표

각 Task는 표의 테스트를 먼저 RED로 재현 → 담당 경로만 구현 → 같은 테스트 GREEN 및 회귀 → 다른 워커 읽기 전용 리뷰 순서다. 정상 동작은 GREEN까지 완료해야 하며 문서 체크만으로 대체하지 않는다.

| ID / 단계 | 담당·시간 | 산출·주요 경로(위 소유권 표의 경로 기준) | 의존성 / 검증 |
|---|---|---|---|
| T01 / W0 | A·2h | FIX 최종 diff/계약·회귀 인수, 충돌 파일 예약 | FIX 결과; A02/A03 legacy 회귀, 실패는 FIX 반환 |
| T02 / W1 **완료(§7)** | A·4h | contracts schemas/dictionary/fixtures + 신규 schemas/biosignal.py, raw·ACK·manifest·artifact·indices typed DTO 동결 G1 | spec+본 plan; A01/A04/A05/A06/A10 fixture review |
| T03 / W1 | C·4h | biosignal_decoder.py, test_sdd244_decoder.py; v1/v2 decode_raw_chunk | G1; A01/A04/A13, signed 경계·truncated·unsupported |
| T04 / W2 | A·5h | M1+record/biosignal model, schemas/eeg/biosignal, eeg_raw_service/storage_service/session API의 세 신호 검증 ACK 확장 | T01+G1; A01~A03, test_sdd244_ingest/pg ingest |
| T05 / W2 | A·4h | M2+feature/model snapshot/artifact 원장·API·기존 session_service/WS 미전달 필드 연결 | T04; A05/A06, legacy feature ACK 회귀 |
| T06 / W2 | A·4h | gap/close intent/manifest revision API·서비스, M3(연구/삭제 schema만) | T05; A08/A11, PG 동시 close/ACK |
| T07 / W2 | B·5h | biosignal capture·parser metadata·clock·raw encoder, bluetoothService/StreamProcessor raw 선수집 | T01+G1; A01/A04, frontend/tests/sdd244-capture.test.ts |
| T08 / W2 | B·5h | FIX 큐 확장, useBiosignalCapture/useBand, api adapter, lease/quota/restart·close intent | T07+T04; A02/A03/A08, sdd244-queue.test.ts |
| T09 / W3 | B·5h | processor 전체 feature emit·raw-derived 분리·기존 스칼라 누락 매핑 | T08+T05; A05, sdd244-features.test.ts |
| T10 / W3 | B·4h | PPG overlap/시간 gate·LF/HF/SQI fixture, 재현된 결함만 algorithm version 변경 | T09; A07, sdd244-algorithms.test.ts |
| T11 / W3 | B·5h | metric-display/MemberClassContainer/ClassPlayerPage 동일 snapshot 1Hz·모델 params/B0/화면 상태 | T09+T10; A06, sdd244-display.test.tsx |
| T12 / W3 | C·4h | biosignal_export_adapter.py + independent artifact verifier, 243 ZIP 소비 계약 | T03+T06; A10/A13, test_sdd244_export_contract.py |
| T13 / W3 | C·5h | research_export_service·research_export API 신호별 v3/ACK/철회 | T06+T12; A11, test_sdd244_policy.py/PG |
| T14 / W3 | C·4h | retention_sweep_service/eeg_raw_task raw-equivalent90일·삭제 outbox 재시도 | T13; A11 90일·보류·객체실패 |
| T15 / W4 | C·4h | measure/verify scripts: 1·20명 합성60분, 웹+243 합동 독립 복원/용량·회귀 | T08~T14; A01~A08/A10~A13 |
| T16 / W4 | C·3h | LINK BAND+Chrome/Edge 각각60분·실제 화면/업로드/다운로드 증거, B는 결함 수정 담당 | T15; A09 웹·A06/A12, verify 증거 인계 |
| T17 / W5 | B·4h | 앱 capability/큐 재개·adapter profile 및 bundled JS 빌드 준비 | 웹 W4 통과; A03/A04 합성25Hz 및 구 앱 회귀 |
| T18 / W5 | C·4h | iOS/Android 각60분 실기기·background/잠금/재시작/네트워크 검증 | T17+별도 앱 실행 승인/장치 준비; A09 앱·A12 |

- 총 예상75시간(18 Task 합계), 병렬 경과시간은 FIX·243·실기기 준비/결함 재시험에 따라 달라진다. 5시간 초과 결함은 해당 Task를 재분할하고 소유권 유지한다.
- W1: G1 후 A/B/C 및 243 병렬. W2: A의 T04→T05→T06, B의 T07→T08, C의 T03. W3: B T09→T10→T11과 C T12→T13→T14 병렬. W4는 통합 인수, W5는 앱 확대다.
- 각 Task 완료 체크: [ ] RED 증거 [ ] 구현 diff [ ] GREEN/회귀 [ ] 독립 리뷰. 실제 추적 시 Task별로 복제하며 현 상태는 모두 미실행.
- 243 계약 변경은 additive version+fixture 갱신을 A만 수행하고 소비자와 재확인한다. 파일 충돌이 생기면 해당 Task를 순차화하고 다른 담당의 파일을 몰래 수정하지 않는다.

## 6. 검증 실행·위험·인계

[verify.md](verify.md)의 A01~A13이 인수 정본이다. 앞으로 BE cwd에서 `pytest tests/test_sdd244_*.py`, PG는 격리 DB 승인 환경에서 `pytest tests/pg/test_sdd244_*.py`; FE cwd에서 `npx vitest run tests/sdd244-*`와 FIX 회귀, `npm run build`를 수행한다. glob은 실제 생성 파일로 확장되는지 확인한다. C 독립 스크립트는 구현 decoder를 oracle로 재사용하지 않고 golden packet/expected rows/hash를 대조한다. 이번에는 이 명령을 실행하지 않는다.

| 위험 | 처리·출시 차단 기준 |
|---|---|
| FIX 완료 지연/동일 파일 충돌 | T01 미인수면 관련 Task 대기. duplicate patch 금지, contract/decoder만 독립 진행 |
| feature 발생 빈도·JSON 확대로180–650MB 초과 | 모든 emit 보존한 채 실제 byte/객체/CPU/메모리 계측. 청크/압축/예산 재산정 후 인수, 임의 필드 생략 금지 |
| 브라우저 quota·OS 종료 | 안전 중단·unknown tail·pending 표시. 100ms 무손실 보장 금지, silent loss 1건도 차단 |
| firmware endian/ACC25·30Hz/header anchor 불명 | 원문 보존, unknown profile·제한 capability. 검증된 프로필만 확대, 앱이라고25Hz 강제 금지 |
| ACK 후 재PUT/manifest 동시확정 | 내용 주소·PG unique/transaction·revision pinning·checksum 테스트. mutable overwrite 발견 시 차단 |
| research 동의/수신자 v3 미지원 | 해당 신호 반출 차단/미ACK 보류; 삭제 게이트도 신호별 검사, 기존동의 자동 확대 금지 |
| 과거 데이터와 신규 completeness 혼동 | unsupported/not_collected/expired/withdrawn 분리. v1 시간·ADC·화면 snapshot 소급 복원 금지 |
| 화면값과 저장값 분리·모델 교체 | 동일 snapshot 객체·source_feature/model hash·실제 DOM 대조, 최신모델 재계산으로 통과 금지 |
| SDD-243 계약/파일 충돌 | G1 commit 기준 adapter 경계 유지, ZIP/인가 파일은243 소유. 웹/앱 인수 상태를 따로 보고 |
| migration 잠금/복수 head | A 단독 작성·격리 PG 업그레이드/구버전 공존 시험. 운영 실행/자동 downgrade 없음 |

다음 실행 인계에는 FIX commit, G1 contract commit, 워커별 diff·RED/GREEN 로그, 웹/앱별 미실행 항목, 실제 capacity 표를 남긴다. Stage ④~⑥·summary 작성·배포는 이번 문서 작업 완료에 포함하지 않는다.


## 7. T02 실행 결과 — G1 계약 동결(2026-10-24)

- **G1 계약 확정 commit: `56fbc926b87f2085fd4f1b6537325eb75a39b50f`** — `feat(sdd-244): T02 데이터 계약 동결(G1)`.
- 기준 plan `29c62915`, Brian 승인(유실 FIX 분리·웹 우선·MB 원본 ZIP 우선)에 따라 **T02만** 실행했다. 자기 커밋 해시의 순환 참조를 피하기 위해 이 해시 기록은 별도 문서 커밋으로 남긴다.
- 산출: `contracts/{raw-v2,manifest-v1,feature-v1,indices-v1}.schema.json`, `field-dictionary-v1.json`, `README.md`, `generate-fixtures.py`, 합성 binary/CSV/JSON·inventory/error fixtures, `backend/app/schemas/biosignal.py`, `backend/tests/test_sdd244_contracts.py`.
- [x] T02 RED 증거 [x] 구현 diff [x] GREEN/허용 범위 회귀 [x] 구현자와 분리한 읽기 전용 리뷰 및 감독 재검증.
- T01 FIX 인수·T03 decoder·마이그레이션·서비스·프론트·업로더 파일은 변경하지 않았다. G1은 계약 개발 착수 기준이며 W4/W5·실제 저장/다운로드 인수 또는 SDD 전체 완료를 뜻하지 않는다. 구현 전 verify.md는 변경하지 않았다.

### 확정 결정과 이유

- raw-v2는 `MBRAW002` + LE32 header length + JSON + 무패딩 section, EEG 17B/PPG 8B/ACC 18B stride다. ADC 정본과 float32 당시 변환값·원문 packet·sample-map을 함께 보존한다. EEG250Hz·2ch, PPG50Hz red/ir, ACC parser 명목 유리수와 관측률/관측창/미확인 사유를 분리한다. native25Hz는 후보 header이며 장치 검증 증거가 아니다.
- 신규 µs는 canonical int64 문자열, 시간은 index/유리수 rate로 계산하여 마지막 출력 때만 반올림한다. original tick·arrival과 계산 sample time은 별도다. gap은 upload_pending과 수집 손실을 구분하고 불명 손실량은 null이다.
- 기존27개 이름·의미 유지: quality는 valid/degraded/invalid 문자열, 기존 device_timestamp_ms는 소수 ms number다. filteredData/SQI/magnitude는 raw-derived 참조로 분리한다. 상세 비유한값은 null+정확한 경로별 사유로 보존하며 NaN/Inf 자체는 거부한다.
- 화면6은 집중/이완/감정균형/BPM/호흡/HRV만 저장한다. HRV는 SDNN(ms), RMSSD는 별도 feature다. 당시 표시 정수·입력·출처·gate/held/stale와 모델/알고리즘/표시 버전을 고정한다. B0에 없는 sigmoid 파라미터는 조작하지 않고 null+버전/사유로 기록한다.
- close intent는 stream/segment/signal별 chunk/feature 순번과 수신수, stream/view별 snapshot 순번을 보존한다. expected artifact ID/hash·gap 순번 검증과 실제 원장/인가 대조의 책임을 분리한다. 후자는 T06에서 구현한다.
- JSON Schema는 구조 계약이며 교차 필드 의미검증과 int64 bounds는 DTO/README 규칙도 적용해야 한다. 공개 manifest alias와 내부 UUID/object key를 분리하되, 실제 가명화·정책 집행은 후속 adapter와 SDD-243의 책임이다.

### RED → GREEN 및 독립 확인

| 검사 | 결과·증거 |
|---|---|
| 최초 RED | DTO/fixture 부재로 31 failed. 테스트를 먼저 작성한 뒤 구현. 도구 실행 기록에 출력 보존 |
| 리뷰 수정 RED | 품질/시간/숫자/단위·wire/모델/원본참조·종료 scope/상세 null/사전 매핑의 추가 실패를 확인 후 수정. 최종 coverage 불일치도 `3 == 4` 실패 재현 후 수정 |
| 계약 focused | `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 PYTHONPATH=/tmp/sdd244-contract-deps <Python> -m pytest --noconftest backend/tests/test_sdd244_contracts.py -q` → **58 passed** |
| 기존 순수 회귀 | backend cwd에서 `test_eeg_metrics.py`, `test_normalization_score.py`를 `--noconftest -k 'not test_report_active_model_and_serialization'`로 실행 → **49 passed, 1 deselected**. 변경 전/후 동일 |
| 감독 통합 재실행 | 계약+위 기존 회귀 → **107 passed, 1 deselected, 1 warning**. Python audit hook으로 `.env` 파일 open·sqlite3.connect·socket.connect를 차단한 상태에서 실행. warning은 기존 passlib의 crypt 폐기 예고 |
| 독립 리뷰어 재실행 | coverage 보정 직전 계약 **57 passed**, 구조/소비자 리뷰 차단사항 없음. 추가 coverage 테스트와 최종58은 감독이 직접 재검증 |
| 재생성 | 계약 디렉터리21개 파일의 SHA-256을 재생성 전후 비교 → 전체 동일 |
| diff | `git -c core.whitespace=cr-at-eol diff --cached --check` 통과. CSV는 RFC4180 CRLF를 의도적으로 유지 |

검증 Python은 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python`(pytest/Pydantic 기존 환경), JSON Schema 검사기는 `/tmp/sdd244-contract-deps`의 jsonschema다. 제품 requirements·공통 conftest를 바꾸지 않았다.

**미실행/한계:** 전체 backend pytest는 공통 fixture와 일부 테스트가 DB·환경설정을 사용하므로 이번 DB/.env 금지 범위에서 실행하지 않았다. DB 생성 테스트 `test_report_active_model_and_serialization` 1개를 명시적으로 제외했으며 전체 회귀 무결성을 주장하지 않는다. 실제 디코더·API·PG·스토리지·ZIP·브라우저·실기기·60분 용량 검증은 후속 Task 대상이다. 실제 바이너리/CSV 해시와 구조 예시용 `aaaa...` model/artifact placeholder를 README에서 구분했다. fixture는 업로드 가능한 실제 close intent가 아니다.

### SDD-243 소비자 관점 자체·독립 리뷰

입력은 SDD-243 `spec.md` §3.4, §4.3(다운로드 파일 구성)이며 해당 워크트리는 읽기만 했다. 실제 SDD-243 구현팀의 승인이나 통합 실행 결과를 대신하지 않는다.

1. 기존 `features.csv` 27개+키, `indices.csv` 화면6+각 입력/정규화 메타, raw CSV 3종 컬럼을 대조했다. 사전 source_metric은 focus_index/relaxation_index/emotional_stability/heart_rate/respiratory_rate/sdnn으로 고정했다. 당시값 미확인은 null+display_history_missing/unverified, 재계산은 reconstructed/false다.
2. `manifest-v1`은 **회차·참여자 revision**이다. 243은 이를 pin하고 별도 ZIP job/part manifest(전체 part 목록·완료 상태)를 조립해야 한다. root README/dictionary/manifest, 1GB=1,000,000,000B, 독립 part·중첩 ZIP 금지는 243 소유다.
3. v1 float32와 raw-v2 컨테이너의 schema dispatch, 추가 raw/packet/sample-map/raw-derived/display-status 경로, stream/segment 분리 파일명, `[from,to)`와 bin extra range를 확인해야 한다. ACC30Hz 고정·native25Hz 자동 재라벨은 금지다.
4. 기본 가명 반출은 session 상대시각·alias만 사용한다. 원 UUID/tick/UTC 포함 raw bin은 무손실 권한 없으면 차단 또는 명시적 redacted_packet_view로 제공한다. 가명 feature device_timestamp_ms는 null, 기본 화면은 participant_player(없으면 session_player)다.
5. 해결한 리뷰 지적: 기존 quality/소수ms 보존, ACC 파형 보관분리, ADC24/lead-off/MB 환산계수, B0 파라미터, 다중 stream/segment/view 종료 순번, 상세 null 사유, 6지표 원천 매핑, EEG fixture coverage4 정합. 추가 G1 차단사항 없음.
