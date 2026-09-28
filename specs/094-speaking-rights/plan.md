# [SDD-094] — Implementation Plan

**Goal:** 온라인 1:N 발언권 관리(손들기→부여/해제), 온라인 1:1은 상시 송출 유지.

**Architecture:**
```
[회원] 손들기 버튼 → POST raise-hand (raise_hand=true)
[상담사] 참여자 목록에서 손들기 확인 → POST speaking {granted:true} (speaking=true, raise_hand=false)
[백엔드] WS speaking_changed → 호스트 + 본인 룸
[회원] speaking_changed 수신 → member_livekit_token 재발급(can_publish=true) → 재연결 → 카메라/마이크 ON
[상담사] 해제 → speaking=false → 회원 can_publish=false 재발급 → OFF
```

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Create | `backend/alembic/versions/xxxx_add_speaking_columns.py` | `session_participants`에 raise_hand/speaking 추가 |
| Edit | `backend/app/models/session.py` | SessionParticipant에 `raise_hand`/`speaking` 컬럼 |
| Edit | `backend/app/schemas/session.py` | Speaking 관련 요청/응답 스키마 |
| Edit | `backend/app/api/v1/session.py` | raise-hand / speaking 부여·해제 엔드포인트 |
| Edit | `backend/app/services/session_service.py` | `member_livekit_token` can_publish 발언권 반영 + speaking 상태 변경 서비스 |
| Edit | `backend/app/ws/session_live_namespace.py` | `speaking_changed` 브로드캐스트 + notify 브리지 |
| Edit | `backend/tests/test_member_livekit_token.py` (또는 신규) | 발언권 기반 can_publish 케이스 |
| Edit | `frontend/src/hooks/useMemberLiveKit.ts` | speaking 상태 수신 시 토큰 재발급 |
| Edit | `frontend/src/components/class/CounselorLiveTile.tsx` | 손들기 버튼 + speaking 반영 |
| Edit | `frontend/src/pages/sessions/ClassPlayerPage.tsx` (또는 상담사 패널) | 참여자 손들기 표시 + 부여/해제 |

## Tasks

### Task 1: BE — 모델 + 마이그레이션
`SessionParticipant`에 `raise_hand: bool`(default False), `speaking: bool`(default False) 추가 + Alembic 마이그레이션.

### Task 2: BE — REST 엔드포인트 + 서비스
- `POST /sessions/{id}/participants/{pid}/raise-hand` — 회원(또는 게스트 토큰) 손들기.
- `POST /sessions/{id}/participants/{pid}/speaking` body `{granted: bool}` — 상담사 부여/해제.
- 상태 변경 시 `notify_speaking_changed`(WS) 호출.

### Task 3: BE — can_publish 발언권 반영
`member_livekit_token`: `can_publish = online AND (one_on_one OR (group AND max_participants≤20 AND participant.speaking))`.

### Task 4: BE — WS 이벤트
`speaking_changed` 브로드캐스트(호스트 룸 + 본인 룸) + `notify_speaking_changed` sync 브리지.

### Task 5: BE — 테스트
발언권 기반 can_publish(그룹 기본 False → speaking True → True, 1:1 항상 True) + raise-hand/speaking 엔드포인트 검증.

### Task 6: FE — 회원 손들기 + 발언권 반영
손들기 버튼, speaking_changed 수신 시 토큰 재발급·재연결, 카메라/마이크 on/off.

### Task 7: FE — 상담사 발언권 UI
참여자 목록에 손들기 배지 + 부여/해제 버튼.

## Testing Strategy
- `cd backend && venv/bin/python -m pytest` — 전체 + 신규 케이스.
- `cd frontend && npm run build` + `npx vitest run --exclude "**/*.cjs"`.
