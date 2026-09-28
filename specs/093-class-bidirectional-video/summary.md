# [SDD-093] — Summary

## What Was Built

온라인 양방향 영상(회원 카메라·마이크 송출) + 클래스 유형별 정원/영상 규칙.

| File | Description |
|------|-------------|
| `backend/app/services/session_service.py` | `member_livekit_token`에서 `can_publish` 규칙 계산 + 응답에 `can_publish` 포함 |
| `backend/app/schemas/session.py` | 온라인 그룹 ≤50 검증(model_validator) + `MemberLiveKitTokenResponse.can_publish` 필드 |
| `backend/app/api/v1/session.py` | docstring 갱신 |
| `backend/tests/test_member_livekit_token.py` | 양방향/방송/상한 케이스 7개 추가(test_07~test_13) |
| `frontend/src/lib/api/session.ts` | `MemberLiveKitTokenResponse.can_publish` 타입 추가 |
| `frontend/src/hooks/useMemberLiveKit.ts` | `canPublish` state 파싱·반환 |
| `frontend/src/components/class/CounselorLiveTile.tsx` | `video`/`audio`를 `canPublish`로 분기(로컬 송출) |
| `frontend/src/components/player/MemberSessionScene.tsx` | `participantMode`·`maxParticipants` prop 추가 |
| `frontend/src/components/class/GuestMeditationPanel.tsx` | `showCounselorVideo` 계산 + 조건부 렌더 |
| `frontend/src/pages/class-join-page.tsx` | `participantMode`·`maxParticipants` 전달 |

## 핵심 규칙 (단일 소스)

```
회원 송출(can_publish) = online AND (one_on_one OR (group AND max_participants ≤ 20))
상담사 영상 표시(show)  = NOT (offline AND group AND max_participants > 20)
```

- 온라인 그룹 상한 50명(생성/수정 시 초과 거부).
- 상담사 측 `VideoConference`는 `LKVideoConference`(전체 참여자 자동 렌더)를 이미 사용 → 회원이 publish하면 상담사 그리드에 자동 표시(추가 작업 불필요).

## Test Results

- ✅ TS1~TS5: 온라인 1:1 양방향 / 그룹 ≤20 양방향 / >20 방송 / 오프라인 구독 / 온라인 그룹 51 거부 / 오프라인 group >20 영상 숨김 — 코드·테스트로 확인.
- ✅ `backend pytest tests/test_member_livekit_token.py` — 13 passed.
- ✅ `backend pytest` (전체) — **797 passed, 12 skipped**, 회귀 없음.
- ✅ `frontend npm run build` — 0 errors.
- ✅ `frontend npx vitest run` — 9 files, 50 tests passed (`--exclude "**/*.cjs"`, 아래 참조).

## Debugging Journey

- **422 vs 400**: 온라인 그룹 51명 거부의 상태코드가 스펙상 "400"이 아니라 실제로 **422**로 반환됨(Pydantic `model_validator` 위반 → FastAPI 기본 422, 프로젝트 관례 `test_session.py:237`와 동일). 테스트는 `in (400, 422)`로 단언해 견고하게 작성.
- **vitest `.cjs` 실패**: `npx vitest run` 전체 실행 시 9개 `tests/*.test.cjs`가 실패하는데, 이는 `node:test`+`playwright` 모듈 미설치(`Cannot find module 'playwright'`)로 이번 변경과 무관한 기존 환경 문제. `.cjs` 제외 시 9개 TS 테스트 파일 50개 전부 통과.
- **응답 필드 누락 위험 회피**: `MemberLiveKitTokenResponse`에 `can_publish` 필드를 추가하지 않으면 라우트의 `response_model` 직렬화가 서비스 반환값을 제거하므로, 스키마 필드까지 함께 수정(백엔드 서브에이전트가 포착).

## Notes for Reviewer

- git commit/push는 하지 않음(로컬 수정만). 커밋 필요 시 `feat(sdd-093): 온라인 양방향 영상 + 정원/영상 규칙` 으로 진행.
- 발언권 관리(손들기 → 부여), 채팅(P2), 공개 방송형(P3)은 Out-of-scope.
- 오프라인 그룹 >20에서 상담사가 여전히 publish하는 대역폭 낭비는 후속 최적화(회원 측 미구독이므로 실사용 영향은 제한적).
- 회원 카메라/마이크 권한 거부 시 UX 안내는 후속 리파인먼트.
