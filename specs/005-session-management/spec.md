# F5 세션 관리 — Spec

## 범위
- F5.1 세션 유형: clinical / hypnosis / meditation
- F5.2 세션 CRUD (생성·수정·삭제·취소)
- F5.3 세션 상태 라이프사이클 (scheduled → in_progress → completed, paused/cancelled 분기)
- F5.4 캘린더 뷰 (Daily/Weekly/Monthly) — FE
- F5.6 그룹 세션 (명상 수업, max_participants)
- 마커 추가 (host, 타임스탬프+메모)
- **제외**: F5.5 반복 일정 (MVP3)

## 도메인 규칙
- 세션 생성·수정·삭제·취소·상태 전이는 **host 상담사만** 가능
- 세션 생성 시 **과거 일시 차단**, 수정은 과거 일시 허용
- 동일 host의 시간 충돌(겹치는 구간) 검출 — `force=true`일 때만 강제 진행
- 상태 전이 규칙:
  - `scheduled` → `in_progress` (start) / `cancelled` (cancel)
  - `in_progress` → `paused` (pause) / `completed` (end) / `cancelled` (cancel)
  - `paused` → `in_progress` (resume)
  - `completed` 종료 상태 (이후 전이 불가)
- 참여자 초대: host만, 정원(max_participants) 초과 차단
- 마커는 host만 추가 (in_progress/paused 한정)

## QA 체크리스트

| # | 항목 | 기대 결과 |
|---|------|----------|
| 1 | 상담사가 clinical 세션을 생성 | 201, status=scheduled |
| 2 | 비로그인 사용자가 세션 생성 시도 | 401 |
| 3 | 과거 일시로 세션 생성 시도 | 400, "과거 일시에는 세션을 생성할 수 없습니다" |
| 4 | 동일 host 시간 충돌 (force 미지정) | 409, "시간이 겹치는 세션이 있습니다" |
| 5 | 동일 host 시간 충돌 + force=true | 201 |
| 6 | host가 본인 세션 조회 | 200 + 세션 객체 |
| 7 | host가 아닌 사용자가 세션 수정/삭제 | 403 |
| 8 | host가 scheduled → in_progress 전이 (start) | 200, status=in_progress |
| 9 | host가 in_progress → paused (pause) → in_progress (resume) | 두 단계 모두 200 |
| 10 | host가 in_progress → completed (end) | 200, status=completed |
| 11 | completed 세션에서 start 재시도 | 400, "잘못된 상태 전이입니다" |
| 12 | host가 scheduled 세션 취소 | 200, status=cancelled |
| 13 | meditation 세션에 참여자 초대(max=5) — 정원 초과 시도 | 6번째 초대에서 400 |
| 14 | 세션 목록 조회 — host인 세션 + 참여자로 포함된 세션 모두 포함 | 200 |
| 15 | 세션 삭제 (host) | 204, 이후 조회 시 404 |
