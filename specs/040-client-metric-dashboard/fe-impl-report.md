# SDD-040 FE 구현 결과

## 변경 파일
- `frontend/src/components/class/GuestMeditationPanel.tsx`
- `frontend/src/components/class/BrainChart.tsx`

## 구현 내용
1. **6지표 순환 대형 수치** — 집중도·이완도·정서안정도·BPM·호흡·HRV를 10초 `setInterval`로 자동 전환. 기존 `heroNumberClass` clamp 스타일 유지.
2. **pin 고정** — `pinnedKey` 토글. ON 시 순환 정지·해당 지표만 표시, OFF 시 10초 순환 재개.
3. **하단 그래프** — `useRef` 링버퍼(1Hz, MAX_POINTS=300)로 6지표 시계열 축적. 선택 지표를 `BrainChart`로 표시. 몸 지표용 `maxValue` 스케일 추가.
4. **인디케이터** — 6개 dot + 클릭 수동 전환. pin 유지 시 클릭한 지표로 pin 대상 갱신.
5. **중복 정리** — 기존 BPM/호흡/SDNN/RMSSD 카드 제거(순환 대형 수치가 주 표시).

## 데이터 매핑
| key | source |
|-----|--------|
| focus | `band.scoredIndices?.focusIndex` |
| relaxation | `band.scoredIndices?.relaxationIndex` (+ WS `remoteEfficiency` 폴백) |
| emotional | `band.scoredIndices?.emotionalStability` |
| bpm | `band.heartRate` |
| respiration | `band.respiratoryRate` |
| hrv | `band.sdnn` |

## 검증
- `cd frontend && npm run build` → 0 error (통과)

## 남은 것
- 브라우저에서 mock/실기기 수동 확인(10초 순환·pin·dot·그래프)
- Stage ⑥ summary.md / Brian 리뷰는 SDD 워크플로 후속
