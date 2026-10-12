# [SDD-133] — Summary

## What Was Built
9건을 7개 파일에 적용했다.

| 이슈 | 변경 |
|------|------|
| ①-3 | WaitingForStart에 LobbyBgmBar 추가(시작 대기 중 BGM 조절) |
| ①-5 | useWaitingRoomPresence effect 의존성에서 nickname 제거 |
| ①-7 | performJoin joinStartedRef 가드 + participantToken 의존성 추가 |
| ①-9 | 좌측 열 order-2 / aside order-1(모바일 이름→입장 순서) |
| ①-11 | #1d1026→#1D1027·bg-white/5→bg-white/[0.06]·검정 오버레이→보라 스크림 |
| ①-12 | 밴드 탭 activeStep===1일 때만 마운트 |
| ①-13 | 연결 시 자동 완료 useEffect 제거(기기 테스트로 버튼 확정) |
| ①-19 | class-waiting-room.ts·WaitingRoomBandCheck 주석을 3단계 강제로 통일 |
| ②-8 | 반응형 브레이크포인트 1024px→1164px |

## Test Results
- ✅ `npm run build` — 0 errors
- ✅ 관련 테스트 4개 파일 42개 통과(①-12/①-13/①-15 반영 수정)
- ✅ 백엔드 `pytest` — 1009 passed

## Notes
- ①-12/①-13: 밴드 탭 활성 시에만 useBand 마운트 + 자동 완료 제거 → 불필요 BLE 연결·자동 전진 방지.
- ①-19: Q2 확정(3단계 강제)에 맞춰 주석 정정. docs는 로드맵에서 별도 갱신 대상.
- 기존 프론트 테스트 실패(signal/login/report/org)는 본 작업 범위 밖 기존 이슈로 확인.
