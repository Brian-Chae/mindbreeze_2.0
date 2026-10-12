# SDD-040 Plan — 클라이언트 6지표 순환 + pin

## 워커: 단일 FE (cursor)

### T1. 6지표 순환 대형 수치
- `GuestMeditationPanel.tsx`: "두뇌휴식도" 대형 수치 → 6지표 순환 영역으로 교체
- 지표 정의 배열 (key/label/source/unit/range)
- 10초 setInterval로 자동 전환

### T2. pin 고정
- pin 상태 + pin 토글 버튼
- pin ON 시 자동 순환 정지, 해당 지표만 표시

### T3. 하단 그래프
- 6지표 시계열 링버퍼 (useRef, MAX_POINTS=300, 1Hz)
- 선택 지표 그래프 표시

### T4. 인디케이터
- 6개 dot + 현재 지표 강조, 클릭으로 수동 전환

## 완료 기준
- build 0 error, 순환 + pin + 그래프 동작
