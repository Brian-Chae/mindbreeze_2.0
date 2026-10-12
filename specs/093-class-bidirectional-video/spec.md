# [SDD-093] 온라인 양방향 영상 + 정원/영상 규칙

## Goal

온라인 클래스에서 회원이 카메라·마이크를 송출(양방향)할 수 있게 하고, 클래스 유형별 정원/영상 규칙(온라인 그룹 ≤50, 20명 초과 시 양방향 차단, 오프라인 1:N 20명 초과 시 상담사 영상 미표시)을 적용한다.

## Context

- 기획안 `docs/클래스-유형-및-실시간-소통-기획.md` 확정 (Brian 브리프 3차 반영).
- 현재 `member_livekit_token()`(`backend/app/services/session_service.py:944-949`)이 **무조건 `can_publish=False`** 를 하드코딩 → 회원은 구독 전용(상담사 영상·음성 수신만).
- 상담사 측 `VideoConference.tsx`는 `LKVideoConference`(전체 참여자 자동 렌더)를 이미 사용 → 회원이 publish하면 상담사 그리드에 자동 표시됨(상담사 측 추가 작업 불필요).
- 클래스 유형은 **신규 필드 없이** `location_type` + `participant_mode` + `max_participants`로 유도한다.

## Scope

### ✅ In-scope
- `member_livekit_token`의 `can_publish`를 규칙 기반 분기 + 응답에 `can_publish` 필드 추가.
- `max_participants` 검증: 온라인 그룹 ≤50 (오프라인은 현행 ≤100 유지).
- 회원 측 카메라·마이크 송출(양방향) — `CounselorLiveTile`이 `can_publish`일 때 로컬 publish.
- 오프라인 1:N >20 → 회원 화면에서 상담사 영상 타일 미표시.
- 백엔드 테스트(`test_member_livekit_token.py`) 확장.

### ❌ Out-of-scope
- 클래스 채팅(P2) — `chat_enabled`, 채팅방 자동 개설·보존.
- 발언권 관리(손들기 → 부여) — 후속 리파인먼트.
- 공개 방송형(>50) 별도 서비스(P3).
- 상담사 측 publish 중지(오프라인 >20에서 대역폭 절약) — 후속 최적화.

## Acceptance Criteria
- [ ] 온라인 1:1 → 회원 토큰 `can_publish=True`.
- [ ] 온라인 group `max_participants ≤ 20` → `can_publish=True`.
- [ ] 온라인 group `21 ≤ max_participants ≤ 50` → `can_publish=False` (채팅만).
- [ ] 오프라인(전체) → `can_publish=False` (현행 유지).
- [ ] 온라인 group `max_participants > 50` → 생성/수정 시 400 거부.
- [ ] 오프라인 group `max_participants > 20` → 회원 화면에 상담사 영상 타일 미표시.
- [ ] `npm run build` 0 errors, `pytest` 통과, `npx vitest run` 통과.

## Dependencies
- LiveKit `generate_livekit_token(can_publish=...)` — 이미 지원(파라미터 존재).
- 기존 프론트 프롭 체인: `class-join-page.tsx` → `MemberSessionScene.tsx` → `GuestMeditationPanel.tsx` → `CounselorLiveTile.tsx`.

## Risks
- **카메라/마이크 권한**: 온라인 양방향에서 회원에게 권한 프롬프트 발생. 거부 시 publish 실패 — LiveKitRoom이 자동 처리하나 UX 안내 필요(후속).
- **20명 동시 publish 대역폭**: SFU(`sfu_enabled`)가 필수. online+group 시 강제 True 확인.
- **규칙 이중화**: 백엔드 `can_publish`와 프론트 표시 분기가 어긋나면 런타임 불일치 → 응답에 `can_publish`를 실어 단일 소스로 통일.
