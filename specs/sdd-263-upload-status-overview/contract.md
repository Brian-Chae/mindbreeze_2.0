# SDD-263 — API 계약 (BE 확정본)

- 정본 spec §4 를 구현 기준으로 구체화. FE 는 이 문서를 따른다. 변경 시 이 문서부터 고치고 FE 에 알린다.
- 기준: 서버 수신(`basis: "server_received"`). 점수·종합점수·좋음/나쁨·완료·100%·보증 값은 응답에 없다. 회차 상태 배지는 SDD-261 참여자 status 의 상위 요약일 뿐이다.
- 회차 단위 상세는 SDD-261 `GET /api/v1/classes/{class_id}/sessions/{session_id}/upload-status`(불변)를 쓴다.

## 1. 요청

```
GET /api/v1/upload-status/overview?limit=30&since=2026-10-02&org_id=<uuid>&class_id=<uuid>&status=needs_attention
Authorization: Bearer <JWT>
If-None-Match: W/"<etag>"      (선택. 직전 응답의 ETag 를 그대로)
```

| query | 타입 | 기본 | 규칙 |
|---|---|---|---|
| `limit` | int | 30 | 1~50. 범위 밖 → 422 |
| `since` | date(`YYYY-MM-DD`) 또는 UTC datetime | 오늘−30일 | 이 시각 이후 시작(유효시각 기준)한 회차. 오늘−90일보다 이전 → 422 |
| `org_id` | uuid | 없음 | platform_admin: 해당 기관만 필터. org_admin: 자기 기관이면 필터, 아니면 404. counselor: 자기 membership 기관이면 필터, 아니면 404 |
| `class_id` | uuid | 없음 | 후보 회차를 해당 클래스로 제한(권한 범위 밖이면 0건) |
| `status` | enum | 없음 | `needs_attention`/`uploading`/`received_unreconciled`/`no_data`. 회차 배지 기준 사후 필터(후보 상한은 필터 **전** 적용). 그 외 값 → 422 |

- 후보 회차: `class_id` 가 있고 hidden(회차·클래스) 아님, `is_template=false`, 상태 `open`/`in_progress`/`completed`, 유효시각(`coalesce(started_at, scheduled_at, created_at)`) ≥ `since`.
- 정렬(서버 고정): `in_progress` 우선 → 유효시각 내림차순 → `session_id` 오름차순.
- `limit` 은 정렬 후 상위 N개를 후보로 자른다. `status` 필터는 그 N개 안에서 적용되므로 `items` 가 `limit` 보다 적을 수 있다.

### 권한

| 호출자 | 결과 |
|---|---|
| 미인증/만료/삭제 계정 | 401 (기존 `get_current_user`) |
| platform_admin(활성) | 200, 전체 기관 (+`org_id` 필터) |
| org_admin — 활성 membership(role=org_admin)·활성 기관 | 200, 해당 기관 클래스 회차만. 타 기관 `org_id` → 404 `upload_status_not_found` |
| counselor — 활성 membership(role=counselor)·활성 기관 | 200, **`session.host_id == 본인`** 인 회차만. 호스트 회차가 없으면 `items=[]`(차단 아님 — 목록 화면 진입은 허용) |
| client / 그 외 role | 403 `upload_status_forbidden` |

에러 본문: `{"detail": {"code": "<code>"}}`. 401 은 기존 `detail: "<문자열>"`. 상세 API 와 달리 비담당 코치는 403 이 아니라 **빈 목록**이다(목록은 "내가 볼 수 있는 것"만 보여 주므로 존재 여부가 새지 않는다).

## 2. 응답 200

헤더:

| 헤더 | 값 |
|---|---|
| `ETag` | `W/"<32hex>"` — 내용 지문(시각 필드 `as_of` 제외) |
| `Cache-Control` | `no-store, private` |
| `Vary` | `Authorization` |
| `X-Poll-Interval` | 다음 조회 권장 초(정수). 304 에도 동일 |

본문 (모든 필드 항상 존재, 값 없음은 `null`):

```json
{
  "as_of": "2026-11-04T05:10:00Z",
  "basis": "server_received",
  "poll_interval_sec": 3,
  "etag": "W/\"<32hex>\"",
  "since": "2026-10-05T05:10:00Z",
  "limit": 30,
  "total_candidates": 62,
  "truncated": true,
  "summary": {
    "sessions": 30, "in_progress": 1,
    "needs_attention": 2, "uploading": 1, "received_unreconciled": 24, "no_data": 3
  },
  "items": [{
    "session_id": "uuid", "class_id": "uuid",
    "class_title": "아침 호흡 명상", "session_title": null, "seq": 3,
    "organization_id": "uuid", "organization_name": "기관",
    "session_status": "in_progress",
    "started_at": "2026-11-04T05:00:00Z", "ended_at": null,
    "participants": 40,
    "needs_attention": 2, "uploading": 1, "received_unreconciled": 30, "no_data": 5, "excluded": 2,
    "band_not_connected": 4,
    "last_received_at": "2026-11-04T05:09:58Z",
    "status": "needs_attention"
  }]
}
```

### 필드 정의

| 필드 | 정의 |
|---|---|
| `as_of` | 서버 집계 시각(UTC 초 단위 `…Z`). ETag 에 포함되지 않음 |
| `since` | 적용된 하한(UTC) |
| `total_candidates` | 권한·필터 조건을 만족하는 전체 후보 회차 수(`limit` 적용 전, `status` 필터 전) |
| `truncated` | `total_candidates > limit` |
| `summary.sessions` | `items` 길이. `summary.in_progress` = `session_status=="in_progress"` 항목 수. 나머지는 `items[].status` 별 회차 수(점수·비율 아님) |
| `class_title` | 클래스 제목(없으면 `null`), `session_title` 는 회차 제목(없으면 `null`), `seq` 는 클래스 내 회차 번호(없으면 `null`) |
| `organization_*` | 클래스 소속 기관(없으면 `null`) |
| `session_status` | 기존 `sessions.status` 문자열(`open`/`in_progress`/`completed`) |
| `started_at`/`ended_at` | 없으면 `null` |
| `participants` | 활성 참여자 수(상세와 같은 범위: 제거·대기열 취소·승계됨 제외, 게스트·대기열 포함) |
| `needs_attention`…`excluded` | 참여자 status 별 인원(합 = `participants`). 정의는 SDD-261 contract §2 와 동일 |
| `band_not_connected` | `collection_state=="eligible"` 이고 `band_connected==false` 인 인원. **미착용 확정 아님**(연결 상태일 뿐) |
| `last_received_at` | 회차 내 참여자 `feature.last_received_at`·`raw.last_received_at` 최댓값 또는 `null` |
| `status` (회차 배지) | 위쪽 우선: `needs_attention`(인원>0) > `uploading`(인원>0) > `received_unreconciled`(인원>0) > `no_data`(그 외, 참여자 0명·전원 excluded 포함) |

- 회차 배지 `no_data` 의 FE 표기는 "수신 기록 없음" 이상으로 단정하지 말 것(미수신≠미착용·소실 확정 금지).
- `status` 값에 "완료/보증"은 없다. `received_unreconciled` = "수신 확인 · 전체 대조 미확인".

## 3. 응답 304

- `If-None-Match` 가 현재 ETag 와 일치(약한 비교, `*` 허용, 쉼표 목록 허용) → 본문 없이 `304`. 헤더 `ETag`·`Cache-Control`·`Vary`·`X-Poll-Interval` 포함.
- 권한(역할·membership)은 304 판정보다 먼저 평가한다. 그래서 권한이 회수되면 304 가 아니라 즉시 빈 목록/404/403 이다.
- ETag 는 다음 변화에 바뀐다: 후보 회차 구성·정렬, 각 회차의 참여자 status 별 인원·`band_not_connected`·`last_received_at`·`session_status`·`ended_at`, 클래스/기관 표시명. `as_of` 는 영향 없음.

## 4. X-Poll-Interval 규칙

| 조건 | 초 |
|---|---|
| 항목 중 `session_status=="in_progress"` 있음 | 3 |
| 아니고, 종료 30분 이내 `completed` 항목 중 `uploading` 인원>0 또는 `last_received_at` 이 90초 이내 | 7 |
| 그 외 | 60 |

FE 는 이 값을 우선 따른다(헤더가 없으면 본문 `poll_interval_sec`).

## 5. 성능·캐시 계약

- SQL(본문 계산, 회차 수 무관): 후보 1(권한 범위 + 정렬 + `count() over()`) + 참여자 1 + feature 1 + raw 1 = **4회**. (HTTP 경로는 `get_current_user` 1회 추가.) 캐시가 전부 유효하면 후보 쿼리 1회만.
- 회차별 요약은 프로세스 내 캐시: 진행 중 2s / 종료 30분 이내 10s / 그 외 300s. 권한 범위·후보 선정은 캐시 앞에서 매 요청 수행한다(권한 변경이 캐시로 가려지지 않음).
- 결측 계산: 스트림별 `max(index)-min(index)+1-count`(유일 제약 하에서 SDD-261 윈도 함수와 같은 값, 앞·뒤 미상 미포함).
- 목표: 50회차 p95 < 1.5s(200), 캐시 적중 304 < 0.15s. PG 실측은 `impl-notes-be.md`.
- CORS: SDD-261 에서 `expose_headers` 에 `ETag`·`X-Poll-Interval` 추가됨. 본문에도 `etag`·`poll_interval_sec` 가 있다.
