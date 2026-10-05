# [SDD-126] 참여자 데이터 정합 — 게스트 멱등 · 대기열 관제

## Goal
1. 게스트가 새로고침·재접속해도 **유령 참가자가 중복 생성되지 않게** 한다(participant_token 기반 멱등).
2. 대기열 회원이 코드로 입장하면 기존 참여자 행의 `is_waitlisted`를 해제해 **관제·좌석·인원 집계에 반영**한다.

## Context
- 전수조사 기획서 `docs/회원-세션-대기-진행-화면-전수조사-기획서.md` §2-3(③-4 대기열 관제 누락), §2-4(③-3 게스트 유령 참가자).
- 게스트 경로(`session_service.py:1333-1337`)는 호출마다 새 `SessionParticipant` 생성 → 새로고침마다 유령 누적.
- 회원 경로(`session_service.py:1307-1322`)는 `existing`을 재사용하지만 `is_waitlisted`를 해제하지 않음 → 대기열 회원이 입장해도 관제·집계에서 제외.
- `participant_token`(JWT, `sub`=participant.id)이 이미 존재하고, `member_livekit_token`에서 `_decode(participant_token, "report_participant")`로 검증하는 재사용 패턴이 있다.

## Scope

### ✅ In-scope
- `join_session_by_code`에 `participant_token` 파라미터 추가.
- 게스트: 유효 토큰이면 decode → 기존 행 재사용(멱등). 무효/부재 시 신규 생성(기존 동작 유지).
- 회원: `existing.is_waitlisted` 해제 + `waitlist_position=None`.
- `JoinByCodeRequest`(백엔드)·`JoinByCodePayload`(프론트)에 `participant_token` 추가.
- 프론트 `class-join-page.tsx`: 저장된 `participant_token`을 재참여 시 전달.

### ❌ Out-of-scope
- `_promote_waitlist`(대기열 자동 승격) 로직 변경.
- 리포트 이메일 인증 플로우.
- LiveKit 토큰 발급 로직.

## Acceptance Criteria
- [ ] 게스트가 같은 `participant_token`으로 재참여하면 새 행이 생기지 않고 기존 행을 재사용한다.
- [ ] 대기열 회원이 코드로 입장하면 `is_waitlisted=False`·`waitlist_position=None`이 된다.
- [ ] 회원·게스트 모두 관제·좌석·인원 집계에 정상 반영된다.
- [ ] `pytest` 통과, `npm run build` 0 errors.

## Dependencies
- SDD-125(일시정지 제거) 완료 — `session_service.py` 공유(순차).

## Risks
- **토큰 무효 처리**: decode 실패·sub 불일치 시 403 대신 신규 생성(기존 동작)으로 폴백 → 멱등 실패 시에도 입장은 막지 않는다.
- **이름 충돌**: `participant_token` 파라미터와 `report_email_service.participant_token` 함수 import가 충돌 → `import ... as make_token`으로 회피.
- **대기열 해제 후 정원**: 코드 자발 입장은 정원 무관(기존 동작 유지), `is_waitlisted`만 해제.
