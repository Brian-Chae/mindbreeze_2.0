# SDD-261 — API 계약 (BE 확정본)

- 정본 spec §3 을 구현 기준으로 구체화한 계약. FE 는 이 문서를 따른다. 변경 시 이 문서부터 고치고 FE 에 알린다.
- 기준: 서버 수신(`basis: "server_received"`). 점수·종합점수·좋음/나쁨·완료·100% 값은 응답에 없다. 기대 수(`expected`)·폰 대기량(`phone_report`)은 MVP 에서 항상 `null`.

## 1. 요청

```
GET /api/v1/classes/{class_id}/sessions/{session_id}/upload-status
Authorization: Bearer <access JWT>
If-None-Match: W/"<etag>"      (선택. 직전 응답의 ETag 를 그대로)
```

- query 없음. 회차 1개의 전체 참여자(게스트·0건·대기열 포함)를 한 번에 반환한다(대기열 제외 참여자 `removed_at`/`waitlist_cancelled_at` 은 제외).
- `class_id`, `session_id` 는 UUID. 형식 오류 → 422.

### 권한 (spec §2 매트릭스 그대로)

| 호출자 | 결과 |
|---|---|
| 미인증/만료 토큰/삭제 계정 | 401 (기존 `get_current_user`) |
| platform_admin (활성) | 200 (모든 기관) |
| org_admin — 해당 클래스 기관의 활성 membership(role=org_admin) | 200 |
| counselor — 활성 membership + `session.host_id == 본인` | 200 |
| counselor — 같은 기관 활성 membership 이나 host 아님(lead/assistant 포함) | **403** `upload_status_forbidden` |
| 타 기관 org_admin/counselor(해당 기관 membership 없음), 없는 클래스/회차, 클래스-회차 불일치, 숨김(hidden) 회차 | **404** `upload_status_not_found` (존재 비공개, 본문에 다른 정보 없음) |
| client / 그 외 role | 403 `upload_status_forbidden` |

에러 본문: `{"detail": {"code": "<code>"}}` (기존 classes 라우터와 동일 형식). 401 은 기존 `detail: "<문자열>"`.

## 2. 응답 200

헤더:

| 헤더 | 값 |
|---|---|
| `ETag` | `W/"<32hex>"` — 데이터 지문 해시. `as_of`·경과 시간 등 시각 필드는 포함하지 않는다 |
| `Cache-Control` | `no-store, private` |
| `Vary` | `Authorization` |
| `X-Poll-Interval` | 다음 조회까지 권장 초(정수). 304 응답에도 동일하게 내려간다 |

본문 (모든 필드 항상 존재, 값 없음은 `null`):

```json
{
  "class_id": "uuid", "session_id": "uuid",
  "session_status": "in_progress",
  "as_of": "2026-11-04T05:10:00Z",
  "basis": "server_received",
  "poll_interval_sec": 3,
  "etag": "W/\"<32hex>\"",
  "summary": {
    "participants": 40, "needs_attention": 2, "uploading": 1,
    "received_unreconciled": 30, "no_data": 5, "excluded": 2
  },
  "participants": [{
    "participant_id": "uuid",
    "display_name": "참여자 예시",
    "is_guest": false,
    "participation_status": "active",
    "collection_state": "eligible",
    "band_connected": false,
    "report_included": true,
    "feature": {
      "received": 118, "legacy_count": 0, "internal_missing": 2,
      "expected": null, "expected_basis": "unknown", "completeness": "unknown",
      "last_received_at": "2026-11-04T05:09:58Z"
    },
    "raw": {
      "signals": [
        {"signal_type": "eeg", "registered": 12, "uploaded": 10, "pending": 1, "failed": 1,
         "internal_missing": 1, "oldest_pending_at": "2026-11-04T05:08:00Z"},
        {"signal_type": "ppg", "registered": 0, "uploaded": 0, "pending": 0, "failed": 0,
         "internal_missing": 0, "oldest_pending_at": null},
        {"signal_type": "acc", "registered": 0, "uploaded": 0, "pending": 0, "failed": 0,
         "internal_missing": 0, "oldest_pending_at": null}
      ],
      "last_received_at": "2026-11-04T05:09:55Z",
      "completeness": "unknown"
    },
    "phone_report": null,
    "status": "needs_attention",
    "reasons": ["feature_internal_gap", "raw_failed"]
  }]
}
```

### 필드 정의

| 필드 | 정의 |
|---|---|
| `session_status` | 기존 `sessions.status` 문자열 그대로(scheduled/open/in_progress/completed/cancelled …) |
| `as_of` | 서버 집계 시작 시각(UTC, 초 단위 `…Z`). 1초 TTL 캐시 중엔 같은 값 |
| `poll_interval_sec` | `X-Poll-Interval` 과 같은 값 |
| `etag` | `ETag` 헤더와 같은 문자열(교차 오리진에서 헤더가 안 보일 때 대비). ETag 계산에는 포함되지 않는다 |
| `summary.*` | participants 를 `status` 별로 센 건수(합 = participants). 점수·비율 아님 |
| `display_name` | 로그인 참여자는 `users.name`, 게스트는 `guest_name`. 둘 다 없으면 `null` → FE 가 “이름 미확인” 표기. 전화·이메일·생년월일 없음 |
| `participation_status` | `active` / `waitlisted` |
| `collection_state` | `eligible`(eeg_collection_consented=true) / `excluded`(false) / `unknown`(NULL). `consent_eeg`(리포트 동의)와 무관. 대기열 참여자는 `excluded` |
| `band_connected` | 기존 필드 그대로. **미착용 확정 근거로 쓰지 말 것**(미수신≠미착용) |
| `feature.received` | 이 회차·참여자의 `eeg_feature_windows` 행 수(legacy NULL play_group 포함). 재전송 중복은 DB 유일 제약으로 1건 |
| `feature.legacy_count` | `play_group_id IS NULL` 행 수(received 의 부분집합). 결측 계산에서 제외 |
| `feature.internal_missing` | `play_group_id`(stream)별 `window_index` 정렬 후 이웃 간 `max(cur-prev-1,0)` 합. 앞·뒤·미보고 구간 미포함 |
| `feature.expected` / `expected_basis` / `completeness` | MVP 고정 `null` / `"unknown"` / `"unknown"` |
| `feature.last_received_at` | `max(created_at)` 또는 `null` |
| `raw.signals` | 항상 `eeg`,`ppg`,`acc` 3개 순서 고정(0건이어도 0으로 채움) |
| `registered` | 서버에 등록된 `eeg_raw_chunks` 행 수. `uploaded`/`failed` 는 `upload_status` 값 그대로, **`pending` = 그 외 모두**(= registered − uploaded − failed) |
| `raw.internal_missing` | (signal_type, stream_id, segment_id)별 `chunk_index`(등록 행 전체) 이웃 간 `max(cur-prev-1,0)` 합 |
| `oldest_pending_at` | pending 행 중 가장 이른 `created_at` (서버 등록 시각) |
| `raw.last_received_at` | uploaded 행의 `max(coalesce(uploaded_at, created_at))`. **presign 만 생성된 pending 은 수신 시각이 아님** |
| `raw.completeness` | MVP 고정 `"unknown"` |
| `phone_report` | MVP 고정 `null` (“미보고”; 0건으로 치환 금지) |
| `report_included` | `session_participants.report_included` |

### `status` (위쪽 우선) 와 `reasons`

| status | 조건 | 가능한 reasons |
|---|---|---|
| `needs_attention` | raw failed>0, feature·raw internal_missing>0, 또는 raw pending 중 가장 오래된 것이 `as_of` 기준 60초 이상 | `raw_failed`, `feature_internal_gap`, `raw_internal_gap`, `raw_pending_stale` (해당하는 것 모두, 이 순서) |
| `excluded` | `collection_state=="excluded"` 이고 수신 기록(feature 0, raw registered 0) 없음 | `collection_excluded` / 대기열이면 `waitlisted` |
| `uploading` | raw pending>0 (60초 미만) | `raw_pending` |
| `received_unreconciled` | feature received>0 또는 raw uploaded>0, 알려진 결측·실패 없음 | `[]` |
| `no_data` | 위에 해당 없음(수신 0) | `[]` |

- `미착용` status 는 MVP 에 없다(착용 이력 없음). `no_data` 를 “미수신 · 착용 여부 미확인”으로 표기하는 것은 FE 몫이다.
- 수신 기록이 있는 `excluded` 후보는 위 규칙대로 다른 status 를 받고 reasons 끝에 `collection_excluded_now` 가 붙는다.
- `reasons` 는 사용자에게 원인 확정 문구를 만들지 말 것(원인/소실 여부 미확정).

### 정렬

`participants` 는 서버가 `participant_id` 오름차순으로 준다(안정적 순서). 확인 필요 우선·이름 정렬은 FE 가 한다.

## 3. 응답 304

- `If-None-Match` 가 현재 ETag 와 일치(약한 비교, `*` 허용, 쉼표 목록 허용) → 본문 없이 `304`. 헤더 `ETag`, `Cache-Control: no-store, private`, `X-Poll-Interval` 포함.
- 권한 확인은 304 보다 먼저 수행하므로 403/404 가 304 로 가려지지 않는다.
- 브라우저 fetch 에서 `If-None-Match` 를 직접 설정하면 304 가 JS 에 그대로 노출된다. FE 는 ETag 를 메모리에만 보관한다(영구 저장 금지).
- ETag 는 다음 변화에 바뀐다: feature·raw 행 수/최신 시각, raw 상태별 건수, 60초 경과로 stale 이 된 pending 수, 참여자 수/대기/밴드연결/동의/리포트선택 집계, 회차 상태·종료 시각. 이름 변경만으로는 바뀌지 않는다(다음 데이터 변화 때 반영).

## 4. X-Poll-Interval 규칙

| 조건 | 초 |
|---|---|
| `in_progress` | 3 |
| `open` | 5 |
| `scheduled`/`ready` 등 시작 전 | 10 |
| `completed` & 종료 30분 이내 & (raw pending>0 또는 마지막 수신 후 90초 이내) | 7 |
| `completed` 그 외(완결·종료 30분 경과·종료시각 없음 & 조용함), `cancelled` | 60 |

FE 는 이 값을 우선 따른다(없으면 spec §3-1 기본값).

## 5. 성능·캐시 계약

- SQL: 권한 1 + revision 1(= 304 경로 2회). 본문 계산 시 참여자 1 + feature 1 + raw 1 추가 = 총 5회. 인원수와 무관.
- 같은 (class, session) 응답은 서버 프로세스 내 **1초 TTL 캐시**. 권한 확인은 캐시 앞에서 수행. 캐시 적중 시 revision 쿼리도 생략(권한 1회만).
- PostgreSQL 에서는 본문 계산을 read-only REPEATABLE READ 한 트랜잭션에서 수행해 스냅샷 일관성을 보장한다.
- CORS: `backend/app/main.py` 는 BE-1 소유 밖이라 수정하지 않았다. 교차 오리진이면 `ETag`/`X-Poll-Interval` 이 JS 에 안 보일 수 있다(`expose_headers` 에 `X-MB-Refresh-Token` 만 있음). FE 는 `X-Poll-Interval` 이 없으면 응답 본문의 `poll_interval_sec` 를 쓰고, ETag 를 못 읽으면 본문 `etag` 필드를 쓴다 — 그래서 본문에도 `"etag"`(헤더와 동일 문자열)를 넣는다.
