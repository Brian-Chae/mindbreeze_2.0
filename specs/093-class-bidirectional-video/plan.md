# [SDD-093] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현. 멀티에이전트: 백엔드/프론트 병렬.

**Goal:** 온라인 양방향 영상(회원 송출) + 정원/영상 규칙(온라인 그룹 ≤50, 20 초과 양방향 차단, 오프라인 >20 영상 미표시).

**Architecture:**
```
[백엔드] member_livekit_token(code, participant_id)
   └─ can_publish = location_type=="online" AND (participant_mode=="one_on_one"
        OR (participant_mode=="group" AND max_participants<=20))
   └─ 응답: {livekit_token, webrtc_room_id, can_publish}

[프론트] class-join-page(session) → MemberSessionScene(locationType, participantMode, maxParticipants)
   → GuestMeditationPanel(showCounselorVideo 계산, CounselorLiveTile 조건부 렌더)
   → CounselorLiveTile(useMemberLiveKit→canPublish → video/audio={canPublish})
```

**Tech Stack:** FastAPI(SQLAlchemy·Pydantic v2) + React 18/TS + LiveKit components-react.

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Edit | `backend/app/services/session_service.py` | `member_livekit_token` can_publish 분기 + 응답 필드 |
| Edit | `backend/app/schemas/session.py` | 온라인 그룹 ≤50 검증(model_validator) |
| Edit | `backend/tests/test_member_livekit_token.py` | 양방향/방송/상한 케이스 추가 |
| Edit | `frontend/src/hooks/useMemberLiveKit.ts` | `canPublish` 파싱·반환 |
| Edit | `frontend/src/components/class/CounselorLiveTile.tsx` | `video`/`audio`를 canPublish로 분기 |
| Edit | `frontend/src/components/player/MemberSessionScene.tsx` | `participantMode`·`maxParticipants` prop 추가 |
| Edit | `frontend/src/components/class/GuestMeditationPanel.tsx` | showCounselorVideo 계산 + CounselorLiveTile 조건부 렌더 |
| Edit | `frontend/src/pages/class-join-page.tsx` | MemberSessionScene에 participantMode·maxParticipants 전달 |

## Tasks

### Task 1: 백엔드 — can_publish 분기 + 응답 필드
**Objective:** `member_livekit_token`에서 `can_publish`를 규칙으로 계산하고 응답에 포함.
**Files:** `backend/app/services/session_service.py`
**Estimate:** 10min
- `s.location_type`, `s.participant_mode`, `s.max_participants` 기반 `can_publish` 계산.
- `generate_livekit_token(..., can_publish=can_publish)`.
- return dict에 `"can_publish": can_publish` 추가.

### Task 2: 백엔드 — 온라인 그룹 ≤50 검증
**Objective:** 온라인 그룹 세션 생성/수정 시 `max_participants>50` 거부.
**Files:** `backend/app/schemas/session.py`
**Estimate:** 10min
- `SessionCreateRequest`에 `_validate_online_group_limit` model_validator 추가.
- `SessionUpdateRequest`도 동일 검증(필드 Optional 감안, 명시 지정 시만).
- 에러 메시지: "온라인 그룹 클래스는 최대 50명까지 설정할 수 있습니다".

### Task 3: 백엔드 — 테스트 확장
**Objective:** 양방향/방송/상한 케이스 검증.
**Files:** `backend/tests/test_member_livekit_token.py`
**Estimate:** 15min
- 온라인 1:1 → can_publish True.
- 온라인 group ≤20 → True / >20 → False.
- 오프라인 → False.
- 온라인 group 51 → 생성 400.
- `pytest backend/tests/test_member_livekit_token.py` 통과.

### Task 4: 프론트 — useMemberLiveKit canPublish 파싱
**Objective:** 토큰 응답의 `can_publish`를 훅이 반환.
**Files:** `frontend/src/hooks/useMemberLiveKit.ts`
**Estimate:** 5min
- `getMemberLiveKitToken` 응답에 `can_publish` 추가 파싱.
- state `canPublish` + return에 포함.

### Task 5: 프론트 — CounselorLiveTile 로컬 publish
**Objective:** 양방향일 때 회원 카메라/마이크 송출.
**Files:** `frontend/src/components/class/CounselorLiveTile.tsx`
**Estimate:** 10min
- `canPublish`에 따라 `<LiveKitRoom video={canPublish} audio={canPublish}>`.
- 기존 `HostCamera`(원격 카메라만) 유지 — 회원 본인 영상은 자기 화면에 표시하지 않음.

### Task 6: 프론트 — showCounselorVideo 분기 + 프롭 전달
**Objective:** 오프라인 group >20에서 상담사 영상 타일 숨김.
**Files:** `class-join-page.tsx` · `MemberSessionScene.tsx` · `GuestMeditationPanel.tsx`
**Estimate:** 15min
- `class-join-page.tsx`: `<MemberSessionScene participantMode={session.participant_mode} maxParticipants={session.max_participants} ...>`.
- `MemberSessionScene.tsx`: prop 수용 → GuestMeditationPanel 전달.
- `GuestMeditationPanel.tsx`: `showCounselorVideo = !(locationType==="offline" && participantMode==="group" && maxParticipants>20)` → false면 CounselorLiveTile 미렌더.

## Testing Strategy
- `cd backend && pytest tests/test_member_livekit_token.py` — 토큰 정책/상한.
- `cd frontend && npm run build` — TS/번들 0 error.
- `cd frontend && npx vitest run` — 기존 단위 테스트 회귀.
