# SDD-324 plan — BE

## 결정
- 회원 요약은 **별도 엔드포인트** `GET /clients/summary`(기존 `/clients` 응답 불변). `/{client_id}`보다 앞에 라우트 등록.
- 리포트 요약은 **별도 엔드포인트** `GET /reports/summary`. 동시에 hierarchy `summary`에도 같은 전역 키를 추가(동일 정의, 같은 함수).
- 시각은 서비스 함수의 `now` 인자로 주입(시험 고정). API 계층은 주입하지 않음(=현재 시각).
- 새 마이그레이션 없음(아래 §성능).

## API 계약

### 1. GET /api/v1/clients/summary  (코치·기관관리자, 그 외 403)
쿼리 없음. 검색·클래스·기간 필터와 무관한 **전체 조회 범위** 집계.

| 필드 | 타입 | 정의 |
|---|---|---|
| total | int | 연결 회원 수(`GET /clients` 무필터 total과 같음) |
| active_7d / active_30d | int | 최근 7·30일(롤링 24h×N)에 활동(세션 참여·체크인·측정·AI체크인) 있는 회원. `active_within_days`와 동일 정의, 7d ⊂ 30d |
| week_attended | int | 이번 주(KST 월 00:00~now) 실제 회차 참여한 고유 회원. 참여 = `session` 이벤트(진행/종료 회차 started_at 존재·취소 아님·참가행 attendance_status ∉ absent/excused/withdrawn/expected·제거 안 됨) |
| inactive_14d | int | 연결 14일 이상 경과 **그리고** 최근 14일 `session` 참여 없음. never_attended 포함 |
| never_attended | int | inactive_14d 중 연결 후 한 번도 회차 참여 없음(가입 후 무활동 구분) |
| report_unread_members | int | 승인(completed)된 회원용 리포트 중 미열람 ≥1건인 고유 회원 |
| band_worn_members | int | 최근 30일 참여 회원 중 유효 EEG 측정 기록이 있는 회원 |
| attended_members | int | 최근 30일 회차 참여 고유 회원 (`band_worn_members`의 분모 후보. 비율 계산·강조 금지, 건수 둘 다 표기) |

연결 시작 시각: 회원의 active `ClientCounselorLink.matched_at` 최솟값, 없으면(기관 범위 전용) `User.created_at`.

### 2. GET /api/v1/clients?filter=…
`filter` ∈ `inactive_14d | never_attended | week_attended | report_unread` (그 외 422). 위 정의와 같은 집합으로 목록 total·페이지를 제한. 기존 q/class_id/active_within_days/counselor_id/member_type과 AND 결합.

### 3. GET /api/v1/reports/summary  (코치·기관관리자)
범위 = `/reports/hierarchy` 무필터와 같은 세션 범위. 상태 탭·검색과 무관한 **전역**.

| 필드 | 타입 | 정의 |
|---|---|---|
| total_members | int | 회차별 참여자 행 수(대기자 제외, 중복 회원 포함 — hierarchy와 같은 의미) |
| needs_review | int | 승인 필요 + pending_review 회원용 문서 |
| failed_delivery | int | completed + delivery_status=failed 회원용 문서 |
| generation_failed | int | status=error + generation_status=partial 회원용 문서(전역) |
| created_today | int | KST 오늘 `created_at`인 회원용 리포트 |
| member_unread | int | completed·미열람·실회원(user_id 있음) 회원용 리포트 건수 |
| avg_review_hours | float\|null | 최근 30일 승인(수동, approval_source≠auto) 회원용 리포트의 `approved_at − created_at` 평균(시간, 소수 1자리). **리포트 생성 시작~승인 대기 시간**이며 코치 작업 시간 아님. `created_at`은 생성 파이프라인 시작 시점이라 완료 시각 대비 수 분 과대. 표본 0이면 null |
| review_sample | int | avg_review_hours 표본 수 |

### 4. GET /api/v1/reports/hierarchy
- `tab` 허용값 확장: `all|needs_review|failed|generation_failed|created_today|member_unread` (기존 값 동작 불변).
- `summary`에 `created_today`, `member_unread` 추가, `generation_failed`는 탭·검색과 무관한 전역으로 보정. 나머지 기존 키 의미 불변.

### 5. 읽음 처리
`GET /reports/{id}`: 회원용(type=client) 리포트는 회원 본인 열람만 `is_read=true`. 코치(호스트)의 회원용 리포트 상세 조회는 읽음 처리하지 않음. 코치용(type=counselor) 리포트의 호스트 열람 읽음 처리는 유지. 기관관리자는 기존대로 처리 안 함.

## 성능
- 회원 요약: 연결 회원 id 1쿼리 + 활동 이벤트(참여자/세션/EEG/체크인 각 1쿼리, `collect_events` 재사용) + 리포트 미열람 1쿼리 + 연결 시작 1쿼리 → 회원 수와 무관하게 쿼리 수 상수.
- 리포트 요약: 세션 1 + 리포트(컬럼만, content 제외) 1 + 참여자 수 1 → 상수.
- 기존 인덱스(`reports.user_id`, `reports.participant_id`, `session_participants.session_id/user_id`)로 충분 → 마이그레이션 없음.
- 쿼리 수는 시험에서 회원 수 3 vs 12로 비교해 증가하지 않음을 검증.

## Task
1. 시험 작성(RED) 2. 읽음 버그 수정 3. 회원 요약·필터 4. 리포트 요약·hierarchy 확장 5. 회귀 6. summary.md
