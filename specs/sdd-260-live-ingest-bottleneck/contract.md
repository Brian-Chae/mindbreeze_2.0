# SDD-260 — BE 계약 (REST 배치 저장 · summary) — 앱/웹/QA 트랙 정본

- 작성: BE 트랙, 2026-10-31. 근거: plan.md §4 S1·S2·S4, §5.1. 이 문서가 plan §5.1 과 다르면 이 문서(구현 기준)를 따르고 차이는 impl-notes-be.md 에 적는다.
- 공통: 모든 경로 prefix `/api/v1`. 인증은 기존 업로드와 동일 — `Authorization: Bearer <JWT>` **또는** `X-Entry-Credential: <자격>` (`resolve_upload_participant` 재사용: 대기열 참가자 403, EEG 수집 거부 참가자 403 `EEG_CONSENT_REQUIRED`). 종료된 세션도 허용(`allow_completed=True`, 사후 전송).
- 슬롯(archive 동시 상한) **비적용** → `429 archive_busy` 가 나오지 않는다.

## 1. `POST /sessions/{session_id}/features/batch` — 정본 저장 경로

DB 에 feature 를 기록하는 **유일한** 경로다(소켓 `live:metric` 은 저장하지 않는다).

### 요청
```json
{
  "participant_id": "<uuid>",
  "windows": [ <MetricEnvelope> , ... ]   // 1 ≤ n ≤ 300
}
```
- `participant_id`: JWT 사용 시 생략 가능(본인 행으로 확정), 주면 본인과 같아야 한다(다르면 403). 입장 자격 사용 시에도 일치해야 한다.
- `MetricEnvelope` = 기존 소켓 `live:metric` 의 창(`schemas/session_live_ingest.py::parse_metric_window`)과 **동일 필드**(session_id, participant_id, stream_id, stream_generation, sequence(u64 문자열), window_start_us, window_end_us, observed_at_ms(int), clock_anchor_id, clock_uncertainty_ms, device_profile_version, algorithm_version, model_version, feature_hash(sha256 hex), contact, sqi, metrics). 알 수 없는 필드는 거절.
- 앱은 outbox 의 envelope 을 **그대로** 넣는다.

### 응답 200
```json
{
  "session_id": "<uuid>",
  "participant_id": "<uuid>",
  "results": [
    {"stream_id": "<uuid>", "sequence": "12", "status": "accepted", "durable": true},
    {"stream_id": "<uuid>", "sequence": "13", "status": "duplicate", "durable": true},
    {"stream_id": "<uuid>", "sequence": "14", "status": "rejected", "code": "hash_conflict"}
  ],
  "counts": {"accepted": 1, "duplicate": 1, "rejected": 1}
}
```
- `results` 는 요청 `windows` 와 **같은 순서·같은 길이**. 키 = (stream_id, sequence).
- `status`
  - `accepted` — 이번 요청으로 새로 저장·커밋됨. `durable:true`.
  - `duplicate` — 이미 같은 (stream, sequence) 가 **같은 feature_hash** 로 저장돼 있음. `durable:true`. 앱은 acked 처리.
  - `rejected` — 저장 안 됨. `code` 필수.
- `rejected.code` 는 **4종만** (앱은 이 4종만 격리, 나머지·네트워크·5xx 는 재시도):
  | code | 조건 |
  |---|---|
  | `participant_mismatch` | 창의 session_id 가 경로와 다르거나 participant_id 가 확정된 본인과 다름 |
  | `stream_not_owned` | stream 이 없거나(미존재), 다른 참가자 소유이거나, 이 세션 소속이 아님 (존재 여부를 알리지 않기 위해 같은 코드) |
  | `consent_withdrawn` | 그 stream 이 동의 철회로 cutoff 됨 (`cutoff_code=consent_withdrawn`) |
  | `hash_conflict` | 같은 키가 이미 **다른 feature_hash** 로 저장됨 — 첫 저장 보존 |
- lease·offline_bound·24h deadline·straddle·시간검토·generation fencing 판정은 **없다**. 늦게 와도 저장.
- 요청 전체가 검증 실패면 아래 4xx. 창 단위 거절은 항상 200 + `rejected`.

### 저장 규칙 (서버)
- 멱등 키: (session, participant, play_group_id=stream_id, window_index=sequence). 동시 20회 동일 요청 → 물리 행 1.
- `device_timestamp_ms` = `observed_at_ms` (float 변환, **non-null 보장**; 소켓 anchor 환산 값이 아니라 기기 보고 시각을 그대로 쓴다 → 리포트 구간 필터 입력).
- `ingest_path='rest'`. `late = (세션 ended_at 존재 and observed_at_ms > ended_at(ms))`.
- `quality`: 모든 EEG 지표가 invalid 인 창은 `invalid`, 그 외 sqi 파생(기존 규칙).
- 투영(`metrics.updated` outbox)·publish·`_project_latest` 호출 **없음**.

### 에러 (요청 전체)
| HTTP | detail.code | 의미 | 재시도 |
|---|---|---|---|
| 401 | (기존 문구) | 인증 없음/만료 | 토큰 갱신 후 |
| 403 | (기존 문구) / `EEG_CONSENT_REQUIRED` | 타인 대리, 대기열, EEG 거부 | ✗ |
| 404 | (기존) | 세션 없음 | ✗ |
| 422 | `invalid_message` (+`field`) | 스키마 위반, `windows` 0개 또는 **301개 이상** | ✗ (앱 버그) |
| 5xx / 타임아웃 | — | 서버/네트워크 | ✓ full jitter |

422 본문 예: `{"detail": {"code": "invalid_message", "field": "windows"}}`

### 성능 목표
300창 1회 < 2s. 40기기 × 5초 주기 × ≤60창.

## 2. `GET /sessions/{session_id}/features/summary?participant_id=<uuid>`

앱 종료 대조(N2)·QA 대조용.

- 권한: 해당 참가자 **본인**(JWT 또는 입장 자격) 또는 **세션 호스트**(JWT, `sessions.host_id`). 타인 403. `participant_id` 생략 시 본인.
- 호스트 + `participant_id` 필수(생략 시 422).

### 응답 200
```json
{
  "session_id": "<uuid>",
  "participant_id": "<uuid>",
  "total_count": 520,
  "streams": [
    {
      "stream_id": "<uuid>",
      "count": 520,
      "min_index": 0,
      "max_index": 599,
      "contiguous_through": 99,
      "missing_ranges": [[100, 159], [400, 419]],
      "truncated": false
    }
  ],
  "updated_at": "2026-11-04T05:10:11.123456+00:00"
}
```
- `stream_id` = 저장된 `play_group_id`. NULL(레거시) 행은 스트림 목록에서 제외하고 `total_count` 에만 포함.
- `missing_ranges`: min_index..max_index 사이 빠진 인덱스 구간(양끝 포함 `[lo,hi]`), 오름차순, 최대 200개. 더 있으면 `truncated:true`.
- `contiguous_through`: 0 부터 끊김 없이 이어진 마지막 인덱스(0 이 없으면 -1).
- **min_index 이전 / max_index 이후 구간은 서버가 알 수 없다.** 앱은 자기 outbox 의 최대 sequence 와 비교해 `max_index` 이후도 재전송해야 한다(완료 판정 = 로컬 sequence 집합 − 서버 보유 집합 = ∅). 서버 응답만으로 "빈 배열 = 완료"로 판정하지 말고 `contiguous_through == local_max_sequence` 또는 `min_index==0 && max_index==local_max && missing_ranges==[]` 로 판정한다.
- `updated_at`: 해당 참가자 마지막 저장 행의 `created_at`, 없으면 `null`.
- 에러: 401/403/404 위와 동일. 600창 조회 < 200ms.

## 3. `GET /sessions/{session_id}/biosignal-raw/summary?participant_id=<uuid>`

권한·`participant_id` 규칙은 §2 와 동일. 슬롯 비적용.

### 응답 200
```json
{
  "session_id": "<uuid>",
  "participant_id": "<uuid>",
  "total": 1200,
  "uploaded": 1198,
  "pending": 2,
  "failed": 0,
  "streams": [
    {
      "stream_id": "<uuid>", "segment_id": "<id>", "signal_type": "eeg",
      "uploaded": 400, "pending": 0, "failed": 0,
      "min_index": 0, "max_index": 399, "missing_ranges": [], "truncated": false
    }
  ],
  "aliases_uploaded": ["<chunk_alias>", "..."],      // 상한 5000, 초과 시 aliases_truncated:true
  "aliases_truncated": false,
  "receipt_hash": "<sha256 hex>",
  "updated_at": "..."
}
```
- 스트림 키 = (stream_id, segment_id, signal_type). `missing_ranges` 는 `uploaded` 상태 chunk_index 기준 구간 계산(min..max 사이 빠진 인덱스).
- `receipt_hash` = uploaded 청크를 `(stream_id, segment_id, signal_type, chunk_index, checksum, size_bytes)` 오름차순 정렬해 `|` 로 이어 붙인 문자열의 SHA-256. QA 가 DB 에서 재계산해 대조한다.
- 앱(N5)은 로컬 manifest alias 집합 − `aliases_uploaded` 를 재큐잉한다.

## 4. 원시 업로드 변경 (S4)
- `POST /biosignal-raw/presign`, `/ack`, `/biosignal-artifacts/presign`: 24h(`close_deadline`)·`pending_time_review`·`window_unproven` 409 **삭제**. 동의 철회(`archive_rejected`)만 403. 늦어도 `uploaded`.
- 슬롯 16, 대기 0.5s, `Retry-After` 2~6 정수(초) 무작위. 앱은 하한 준수 + full jitter.

## 5. 소켓 `live:metric` (S3)
- 저장하지 않는다. 창마다 ACK `{sequence, status: "projected"|"ignored", code?}` (`durable` 필드 없음). 앱은 이 ACK 로 outbox 를 acked 처리하지 **않는다**.
- 상태 가드(READY 등)는 방송용으로만 유지. `live:device` 는 현행 유지.

## 6. 삭제된 것
- `POST /sessions/{session_id}/features` (v1) → 404. `EEGFeatureBatchRequest` 계열 프런트 참조 0건이어야 함(웹 트랙이 `useBand` 등에서 제거).

## 7. 예시 요청(축약)
```http
POST /api/v1/sessions/6f1c…/features/batch
X-Entry-Credential: <credential>
Content-Type: application/json

{"participant_id":"b2…","windows":[{"session_id":"6f1c…","participant_id":"b2…","stream_id":"9a…","stream_generation":"1","sequence":"12","window_start_us":"11000000","window_end_us":"12000000","observed_at_ms":1762232412000,"clock_anchor_id":"c3…","clock_uncertainty_ms":12.5,"device_profile_version":"linkband2-v1","algorithm_version":"native-1","model_version":"b0","feature_hash":"<64hex>","contact":{"fp1":"contact","fp2":"contact"},"sqi":0.9,"metrics":{"focus_raw":{"value":1.5,"unit":"index_raw","validity":"valid","reason":null,"last_valid_sequence":null,"last_valid_observed_at_ms":null}}}]}
```
