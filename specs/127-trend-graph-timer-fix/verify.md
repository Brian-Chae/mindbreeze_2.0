# [SDD-127] — Verification (Pre-Implementation)

## Test Scenarios
### TS1: 그래프 갱신
1. 진행 화면에서 밴드 연결, 1Hz 링버퍼에 샘플 누적.
- **Expected:** "지난 5분 추이" 그래프가 매초 갱신(숫자와 일치). 참조가 매초 새 배열로 교체돼 `useMemo` 재계산.

### TS2: 타이머 안정성
1. 진행 중 서버 그룹평균 신호(remoteEfficiency)가 여러 번 도착.
- **Expected:** 타이머가 해제·재생성되지 않고 1초 간격 유지.

### TS3: 빌드
1. `npm run build`.
- **Expected:** 0 errors.
