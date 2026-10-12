# [SDD-130] 대기 화면 UX·성능 — 준비 재확인 복귀 · 미터 리렌더

## Goal
1. [준비 다시 확인] 후 3단계 준비 화면에서 대기 화면으로 돌아갈 길을 만든다.
2. 대기 화면 마이크 미터가 초당 60회 전체 리렌더를 유발하지 않게 한다.

## Context
- 전수조사 ①-1(대기 복귀 경로 없음), ①-13(미터 초당 60회 리렌더).
- ①-1 원인: `recheckingPrep=true`가 되면 `WaitingForStart`로 돌아가는 조건(`!recheckingPrep`)을 영원히 만족 못 해 3단계 준비 화면에 갇힘.
- ①-13 원인: `startMeter`의 `requestAnimationFrame` 루프가 매 프레임 `setMicLevel` 호출 → 컴포넌트 전체 60fps 리렌더.

## Scope
- `recheckingPrep` 상태에서 "대기 화면으로" 복귀 버튼 추가(`setRecheckingPrep(false)`).
- 미터 `setMicLevel`을 10Hz(100ms)로 하향.

## Acceptance Criteria
- [ ] 준비 재확인 중 "대기 화면으로" 버튼이 표시되고, 클릭 시 대기 화면 복귀.
- [ ] 미터 `setState`가 100ms 이하 간격으로만 발생.
- [ ] `npm run build` 0 errors.

## Dependencies
- SDD-127 완료(순차). `ClassWaitingRoom.tsx` 단독 수정.
