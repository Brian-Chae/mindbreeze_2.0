# SDD-037 루프5 처리기 정본 이식 결과

요청된 EEG/PPG 처리기 수식 이식을 완료했다. 기존 작업 중이던 UI, index.ts, SDD counter는 수정하지 않았다.

## 수정 내용

- EEG `calculateRawIndices`, `mergeChannelBandPowers`를 HARU feature-worker 정본에서 그대로 이식했다.
- 평균 SQI/100 가중치의 기하평균을 사용한다. FAA 채널 유효성 기준은 정본과 같은 평균 SQI >= 15이며, 이 기준은 병합 가중치를 제거하는 조건이 아니다.
- focusIndex/relaxationIndex/stressIndex의 ×100을 제거하고 EPS=1e-10을 적용했다. focusIndex와 stressIndex는 1보다 클 수 있는 raw 비율이며 relaxationIndex는 0~1 비율이다.
- cognitiveLoad는 두 채널 θ+α+β+γ 합의 평균, totalNeuralActivity는 두 채널 5밴드 합의 평균이다.
- 기존 indices.totalPower 키에 동일한 총합 평균을 유지하고 indices.totalNeuralActivity와 indices.faa를 추가했다. 기존 메서드 입력과 반환 필드는 유지했다.
- bandPowers도 병합된 채널값을 반환한다.
- PPG RR 필터 세 곳(출력 RR, 이상값 제거 전 범위 필터, RMSSD)의 300~1200/1500ms를 200~2000ms 포함 범위로 통일했다.

## 검증 결과

- `node --test frontend/tests/signal-metric-parity.test.cjs`: 8 passed, 0 failed.
- 수정 전 회귀 테스트는 raw 배율, FAA 누락, RR 200/2000ms 제외로 4개 실패함을 확인했다.
- 비대칭 채널 입력: ch1=(1,4,9,16,25), ch2=(9,16,81,4,1), SQI=(80,40)에서 focusIndex≈0.4020432477161083, cognitiveLoad=78, totalPower=totalNeuralActivity=83, FAA=ln(9), hemisphericBalance=-0.8을 확인했다.
- FAA 저품질 null, 0 가중치 채널 제외, 두 가중치 0, 빈 밴드 파워, RR 범위 안팎 경계를 검사했다.
- `cd frontend && npm run build`: exit 0, TypeScript/Vite 완료. CSS tokens.css import 경로 미해결 및 500kB 초과 번들 경고가 출력된다.
- 테스트는 신호 필터/스펙트럼을 고정한 입력으로 처리기 공개 반환 경로와 수식을 검증하며, 신호 전체 파이프라인의 정본 동등성 검증은 아니다.

## 남은 사항

- 현재 useBand.ts의 toScoredIndices는 FAA 입력에 raw.hemisphericBalance를 전달한다. 또한 live metrics에서 FAA를 BandRawIndices로 전달하지 않는다. 요청 대상 처리기에는 FAA를 추가했지만 실제 좌우뇌 점수까지 FAA를 적용하려면 EEGDataProcessor/metrics 타입/useBand 경로의 별도 연동이 필요하다.
- 실제 LINK BAND, 브라우저/mock UI, 관측값 분포 및 포화 해소는 실행 검증하지 않았다.
- PPG 피크 검출 최소 간격 및 최종 BPM 제한은 수정하지 않았다. RR 필터 통일이 전체 PPG 알고리즘의 HARU 정합성을 의미하지 않는다.
- 이 보고서는 요청된 루프5 범위 결과이며 SDD-037 전체 완료나 사용자 최종 승인을 대체하지 않는다.
