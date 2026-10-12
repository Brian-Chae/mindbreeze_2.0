# [SDD-094] — Summary

## What Was Built

온라인 1:N 발언권 관리(손들기 → 부여/해제). 온라인 1:1은 상시 송출 유지.

| File | Description |
|------|-------------|
| `backend/app/models/session.py` | `SessionParticipant.raise_hand`/`speaking` 컬럼 추가 |
| `backend/alembic/versions/e036a0000016_*.py` | 마이그레이션 |
| `backend/app/services/session_service.py` | `_compute_can_publish` 헬퍼 + `raise_hand`/`set_speaking` 서비스 + live-metrics/직렬화에 상태 노출 |
| `backend/app/schemas/session.py` | `ParticipantInfo`에 `participant_id`·`raise_hand`·`speaking`, Speaking 요청/응답 스키마 |
| `backend/app/api/v1/session.py` | `raise-hand` / `speaking` 엔드포인트 |
| `backend/app/ws/session_live_namespace.py` | `speaking_changed` 이벤트 + `notify_speaking_changed` 브리지 |
| `backend/tests/test_sdd094_speaking_rights.py` | 발언권 시나리오 12건 |
| `frontend/src/hooks/useMemberLiveKit.ts` | speaking_changed 수신 → 토큰 재발급, 손들기 API |
| `frontend/src/hooks/useSessionLiveSocket.ts`·`lib/socket.ts` | WS 싱글톤 + speaking_changed 구독 |
| `frontend/src/components/class/CounselorLiveTile.tsx` | 손들기 버튼 + 발언권 배지 + 셀프뷰 |
| `frontend/src/components/session/SpeakingRightsPanel.tsx` | 상담사 발언권 패널(신규) |
| `frontend/src/components/session/SessionParticipantCardGrid.tsx`·`SessionMonitorTable.tsx` | 손들기/발언 배지 |
| `frontend/src/pages/sessions/ClassPlayerPage.tsx` | speaking_changed 오버레이 반영 |

## 핵심 규칙
```
can_publish = online AND (one_on_one OR (group AND max_participants ≤ 20 AND participant.speaking))
```
- 온라인 1:1 → 상시 True. 온라인 그룹 ≤20 → 기본 False, 발언권 부여 시 True. 그 외 False.
- 발언권 UI는 `speakingManaged = online && group && max_participants ≤ 20`일 때만 노출.

## Test Results
- ✅ `pytest` 전체 — **809 passed, 12 skipped** (신규 test_sdd094 12건 + test_member_livekit_token 13건 포함).
- ✅ `npm run build` — 0 errors.
- ✅ `npx vitest run --exclude "**/*.cjs"` — 9 files / 50 tests.

## Debugging Journey
- **프론트가 지적한 BE 갭 2건을 Supervisor가 직접 보완**: ① `get_live_metrics`에 `raise_hand`/`speaking` 누락 → 상담사 모니터 새로고침 시 손들기 상태 미표시 → 필드 추가. ② `ParticipantInfo`/직렬화에 `participant_id` 누락 → 게스트 상태 매핑 불가 → `participant_id` 필드 추가.
- **LiveKit 재연결**: 토큰만 바꾸면 `Room.connect`가 이미 연결 상태에서 즉시 반환해 권한이 반영 안 됨 → `key={canPublish}` 리마운트로 실제 재연결 유도.
- **토큰 재발급**: 발언권 부여 → `speaking_changed` → 회원 `connect()` 재호출 → `can_publish=true` 재발급.

## Notes for Reviewer
- commit/push 별도 진행(이 summary 작성 후).
- 남은 알려진 한계: 회원 재접속 시 "손들기 완료(승인 대기)" 상태 복원 불가(발언권 부여 상태는 정상 복원). 후속 리파인먼트.
