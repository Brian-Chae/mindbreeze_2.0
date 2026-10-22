# SDD-231 verify (구현 전 작성)

## 서버 (pytest, 반복 클래스는 PG 하네스 `tests/pg`, PG_SMOKE=1 로컬 DB)
- [ ] V1 허용 구간(시작 30분 전) 초대 로그인 입장 200, `entered_at` None, `attendance_status` expected
- [ ] V2 허용 구간 코드 입장 200 (`find_enterable_session`이 회차 1개 반환)
- [ ] V3 구간 밖(5시간 전)·구간 후(4시간 후) 입장 409 `session_not_open`, detail.scheduled_at 포함
- [ ] V4 사전 입장 후 `participant_livekit_token` 409, 토큰 미발급
- [ ] V5 회차 open+in_progress(webrtc 방 있음) 후 토큰 발급, `entered_at`·출석 attended 기록
- [ ] V6 정원 초과 사전 입장은 대기열로
- [ ] V7 같은 코드에 허용 구간 회차 2개면 404 유지
- [ ] V8 즉석/비반복 클래스 기존 테스트 회귀 없음
- [ ] V9 `join_session`은 여전히 409(토큰 없음)

## 프론트 (vitest)
- [ ] F1 `preOpenCountdown`: 11분 → 문구, 10분·9분·0 → null, 90분 → `1시간 30분`
- [ ] F2 EntryConfirmView wait: 32분 남음 문구+시작 시각, 시간 진행 후 갱신, 10분 이하 일반 문구
- [ ] F3 `아직 열리지 않았어요` 카드: 409 detail.scheduled_at로 남은 시간 표시
- [ ] F4 EntryPage: unopened 확인 화면 → 서버 status open 되면 준비 단계 자동 진행
- [ ] F5 PR #33 테스트(`entry-page-notyet-retry`) 및 기존 member-machine/entry-page 테스트 통과
- [ ] F6 `npx tsc --noEmit`

## 못 돌릴 수 있는 것
- 실제 LiveKit·WS 실서버, dev 서버 E2E (금지 범위)
