# [SDD-093] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 온라인 1:1 → 양방향 토큰
1. `location_type="online"`, `participant_mode="one_on_one"`, `max_participants=1` 세션 생성·오픈.
2. 회원으로 `POST /sessions/by-code/{code}/livekit-token` 호출.
- **Expected:** 응답 `can_publish == true`.

### TS2: 온라인 그룹 ≤20 → 양방향 / >20 → 방송
1. `online` + `group` + `max_participants=20` → 토큰 호출.
2. `online` + `group` + `max_participants=21` → 토큰 호출.
- **Expected:** 20은 `can_publish==true`, 21은 `can_publish==false`.

### TS3: 오프라인 → 구독 전용(현행 유지)
1. `offline` + `group`/`one_on_one` → 토큰 호출.
- **Expected:** `can_publish==false`.

### TS4: 온라인 그룹 상한 50
1. `online` + `group` + `max_participants=51` 세션 생성.
- **Expected:** 400 응답, 에러 메시지에 "최대 50명".

### TS5: 오프라인 group >20 → 상담사 영상 미표시
1. `offline` + `group` + `max_participants=21` 클래스에 회원 입장.
2. 회원 화면 확인.
- **Expected:** `CounselorLiveTile` 미렌더, EEG·몰입 화면만 표시. 스피커는 기본 뮤트.

### TS6: 빌드/테스트
- `cd frontend && npm run build` → 0 errors.
- `cd backend && pytest tests/test_member_livekit_token.py` → 통과.
- `cd frontend && npx vitest run` → 통과.

## Edge Cases
- [ ] 온라인 group `max_participants=20`(경계) → can_publish True.
- [ ] 온라인 group `max_participants=21`(경계) → can_publish False.
- [ ] 게스트(비로그인)도 양방향 온라인 1:1에서 `can_publish=True` 수신.
- [ ] 회원 카메라/마이크 권한 거부 시 publish 실패해도 상담사 영상 수신은 유지(구독은 정상).
- [ ] `SessionUpdateRequest`에서 `location_type`/`participant_mode`만 부분 갱신 시 상한 검증이 오작동하지 않음.
- [ ] 오프라인 1:N ≤20은 기존대로 상담사 영상 표시(진행·녹화·AI 표시) 유지.

## Security Review
- [ ] `can_publish`는 세션의 `location_type`·`participant_mode`·`max_participants`로만 결정 — 클라이언트 임의 조작 불가(서버 측 계산).
- [ ] `member_livekit_token`은 참여자 권한 검증(participant_id/토큰)을 기존 그대로 통과한 뒤에만 발급.
- [ ] 상한 검증은 Pydantic 스키마 레벨(생성·수정 모두) — 우회 경로 없음.
