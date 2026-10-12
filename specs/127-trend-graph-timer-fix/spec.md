# [SDD-127] 진행 화면 데이터 시각화 — 추이 그래프 정지 · 1초 타이머 리셋

## Goal
1. "지난 5분 추이" 그래프가 숫자와 함께 매초 갱신되게 한다(정지된 그림 해소).
2. 1초 측정 타이머가 서버 신호로 리셋되지 않게 한다(샘플 누락 해소).

## Context
- 전수조사 ②-1(추이 그래프 정지), ②-2(1초 타이머 리셋).
- ②-1 원인: `pushRingPoint`가 `buf.push`로 **in-place 변형** → `MemberTrendGraph`의 `useMemo([data])`가 참조 동일로 판단해 재계산 안 함 → 숫자(72%)는 매초 갱신되지만 그래프는 처음 그린 그림 유지.
- ②-2 원인: 1Hz 링버퍼 타이머 `useEffect` 의존성이 `[readSnapshot]`인데, `readSnapshot`이 `remoteEfficiency`(서버 그룹평균 신호)에 의존 → 신호 도착마다 `useCallback` 재생성 → 타이머 해제·재생성 → 1초 간격이 깨지고 샘플 누락.

## Scope
- `pushRingPoint`를 불변 업데이트(새 배열 반환)로 변경 + 호출부에서 새 배열 참조 교체.
- `readSnapshot`을 `useRef`로 안정화 + 타이머 `useEffect` 의존성 `[]`(1회 생성).

## Acceptance Criteria
- [ ] `npm run build` 0 errors.
- [ ] 링버퍼 갱신 시 `MemberTrendGraph`가 매초 다시 그려진다(참조가 매초 바뀜).
- [ ] 타이머가 컴포넌트 마운트 후 1회만 생성되고 서버 신호에도 유지된다.

## Dependencies
- SDD-126 완료(순차). `GuestMeditationPanel.tsx` 단독 수정.
