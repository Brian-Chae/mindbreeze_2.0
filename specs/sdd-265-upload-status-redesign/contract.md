# SDD-265 — API 계약 (BE, FE 정본)

- 가산 변경만. SDD-261/263/264 의 기존 필드·이름·의미·권한·ETag/304·X-Poll-Interval 규칙은 불변.
- 기준 `basis:"server_received"`. 점수·종합점수·좋음/나쁨·완료·보증 값 없음.
- 변경 시 이 문서부터 고치고 FE 에 알린다.

## 1. 목록 `GET /api/v1/upload-status/overview` (SDD-263 가산)

신규 query:

| query | 타입 | 기본 | 규칙 |
|---|---|---|---|
| `cursor` | string | 없음 | 직전 응답 `next_cursor` 그대로. 해석 불가·변조 → 422 `upload_status_invalid_cursor`. 다른 `org_id`/`class_id`/`since` 와 섞어 써도 정렬 키 비교일 뿐이라 오류 아님 |
| `needs_attention_only` | bool | false | true 면 회차 배지 `needs_attention` 인 회차만 `limit` 개까지 채운다(페이지 선정 전 적용, 앞으로 스캔). `status` 와 함께 주면 422 `upload_status_filter_conflict` |

- `limit`: 1~50, **기본 30(불변)**. 화면은 `limit=10` 을 보낸다.
- `status`(기존): 후보 `limit` 개 안 사후 필터 — 의미 불변.
- 정렬(불변): `in_progress` 우선 → 유효시각 내림차순 → `session_id` 오름차순. cursor 는 이 키의 마지막 항목.
- `needs_attention_only` 스캔 상한: 1요청 4배치×50 회차. 상한에 닿았는데 더 있을 수 있으면 `next_cursor` 는 마지막 **검사한** 회차 기준이고 `scan_limited:true`.

신규 응답 최상위 필드(항상 존재):

| 필드 | 정의 |
|---|---|
| `next_cursor` | 다음 페이지 토큰, 없으면 `null` |
| `has_more` | `next_cursor != null` |
| `scan_limited` | `needs_attention_only` 스캔이 상한에서 멈췄으면 true, 그 외 false |

- `total_candidates`: 권한·필터(`since`/`org_id`/`class_id`) 만족 전체 회차 수, **cursor 와 무관**(첫 페이지와 같은 값). `truncated` = `total_candidates > limit`(불변, 페이지 위치와 무관하니 FE 는 `has_more` 를 쓴다).
- `summary`: 이번 페이지 `items` 기준(불변).

`items[]` 신규 필드(항상 존재, 값 없음 `null`):

| 필드 | 타입 | 정의 |
|---|---|---|
| `participants_expected` | int | `participants − excluded` (수집 대상 인원, 도착 분모) |
| `participants_arrived` | int | 수집 대상 중 분석 데이터 또는 측정 기록 파일이 서버에 1건 이상 도착한 인원 |
| `bytes_arrived` | int | 서버에 도착한 총 바이트(측정 기록 파일 + 분석 데이터 파일) |
| `bytes_expected` | int\|null | 추정 총 바이트. 근거 부족이면 null |
| `bytes_basis` | `"estimate"`\|null | `bytes_expected` 가 있으면 `"estimate"` |
| `duration_min` | int\|null | 회차 측정 길이(분). 진행 중이면 경과 |
| `participant_minutes_total` | int | 참여자별 도착 분석 데이터 창 수(1창=1초) 합 ÷ 60, 내림 |

예: `"participants_expected": 38, "participants_arrived": 36, "bytes_arrived": 1180000000, "bytes_expected": 1250000000, "bytes_basis": "estimate", "duration_min": 52, "participant_minutes_total": 2082`

## 2. 회차 상세 `GET /classes/{cid}/sessions/{sid}/upload-status` (SDD-261 가산)

- 최상위에 위 `items[]` 와 동일 7개 필드(같은 계산 함수).
- `participants[]` 각 항목에 `bytes_arrived`(int), `measured_min`(int, 도착 분석 데이터 창 수÷60 내림) 가산.
- ETag 지문에 새 필드가 들어간다(도착 바이트 변화 → ETag 변경).

## 3. 신규 — 회원 본인 `GET /api/v1/upload-status/me/sessions`

```
GET /api/v1/upload-status/me/sessions?limit=10&cursor=<token>
Authorization: Bearer ***
If-None-Match: W/"<etag>"   (선택)
```

- 대상: 로그인 사용자 본인의 `SessionParticipant`(제거·대기열 취소·승계됨 제외) 중 회차 상태 `in_progress`/`completed`, 숨김·템플릿 제외. 기간 하한 `since`(기본 30일, 최대 90일, 목록과 같은 규칙).
- 권한: 로그인한 모든 role 허용(자기 것만 보임). 비로그인 401. 해당 회차가 없으면 `items:[]`.
- 정렬·cursor·`limit`(기본 10, 1~50)은 목록과 같은 키.
- 헤더: `ETag`, `Cache-Control: no-store, private`, `Vary: Authorization`, `X-Poll-Interval`(진행 중 회차 있으면 5, 그 외 60).

```json
{
  "as_of": "2026-11-04T05:10:00Z", "basis": "server_received",
  "poll_interval_sec": 5, "etag": "W/\"...\"", "since": "...", "limit": 10,
  "total_candidates": 23, "next_cursor": "<token>|null", "has_more": true,
  "items": [{
    "session_id": "uuid", "class_id": "uuid", "class_title": "아침 호흡 명상", "session_title": null, "seq": 3,
    "organization_name": "기관", "session_status": "completed",
    "started_at": "...", "ended_at": "...",
    "status": "received_unreconciled",
    "collection_state": "eligible",
    "progress_state": "in_progress",
    "percent": 94.2,
    "bytes_arrived": 27000000, "bytes_expected": 31000000, "bytes_basis": "estimate",
    "duration_min": 52, "measured_min": 51,
    "last_received_at": "..."
  }]
}
```

| 필드 | 정의 |
|---|---|
| `status` | 목록 배지와 같은 4값(본인 한 명 기준: `needs_attention`/`uploading`/`received_unreconciled`/`no_data`) |
| `collection_state` | `eligible`/`excluded`/`unknown` (excluded 면 수집 제외 — 문제 아님) |
| `progress_state` | SDD-264 `ParticipantProgress.state` |
| `percent` | SDD-264 본인 `progress.total.percent`, 근거 없으면 null |
| `duration_min` | 회차 측정 길이(위 D6) |
| `measured_min` | 본인 도착 분석 데이터 창 수÷60 내림 |
| 나머지 | 목록 항목과 같은 정의, 본인 기준 |

- 타인 정보(이름·인원 수)는 응답에 없다.
- 회원 화면의 "한 줄 조치"는 FE 가 `status`·`progress_state`·`collection_state` 로 만든다(서버는 문구를 주지 않는다).

## 4. 에러

| HTTP | detail | 의미 |
|---|---|---|
| 422 | `{"code":"upload_status_invalid_cursor"}` | cursor 해석 실패 |
| 422 | `{"code":"upload_status_filter_conflict"}` | `status` + `needs_attention_only` 동시 |
| 그 외 | SDD-263 §1 과 동일 | |

## 5. 성능·캐시

| 경로 | SQL(캐시 미스) |
|---|---|
| 목록 | 후보 1 + 참여자 1 + feature 1 + raw 1 + 기대량 1 + 산출물 1 = 6 (캐시 전부 적중 시 후보 1) |
| `needs_attention_only` | 배치마다 위 규칙, 최대 4배치 |
| 상세 | SDD-264 6회 + 산출물 1 = 7 |
| 회원 | 후보 1 + 본인 참여 행 포함 후보에서 참여자 1 + feature 1 + raw 1 + 기대량 1 + 산출물 1 = 6 |

- 회차별 요약 캐시 TTL 불변(2s/10s/300s). 회원 경로는 사용자별로 요약을 만들지 않고 회차 캐시를 재사용하지 않는다(본인 한 명 기준이므로 별도 키 `(session_id, user_id)`, 같은 TTL).
- cursor 가 적용돼도 후보 쿼리는 1회(총 개수는 필터 후·cursor 전 윈도우 카운트).
