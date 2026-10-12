# SDD-040 Summary — 클라이언트 클래스 6지표 순환 + pin

## 구현 결과

`GuestMeditationPanel`(클라이언트 명상 화면)의 두뇌휴식도 단일 대형 수치를 6지표 순환 대시보드로 개편했다.

### 6지표
| key | label | source | unit |
|-----|-------|--------|------|
| focus | 집중도 | scoredIndices.focusIndex | % |
| relaxation | 이완도 | scoredIndices.relaxationIndex | % |
| emotional | 정서안정도 | scoredIndices.emotionalStability | % |
| bpm | BPM | heartRate | bpm |
| respiration | 호흡 | respiratoryRate | 회/분 |
| hrv | HRV | sdnn | ms |

### 기능
- 10초 자동 순환 (기본값)
- pin 고정 (pin ON → 해당 지표만, OFF → 순환 재개)
- 하단 시계열 그래프 (선택 지표)
- 6개 dot 인디케이터 + 클릭 전환

## 검증·배포
- `npm run build` 0 error
- 커밋 `50c6ea4` → Deploy Dev `34818302596` 성공
