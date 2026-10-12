# SDD-037 Summary — 생체신호 지표 정합성 (haru 정본 대조)

## 5번 루프 결과

### 루프 ① haru EEG 지표 계산식 분석
- `calculateRawIndices` 확보: focus=β/(α+θ), relaxation=α/(α+β), stress=(β+γ)/(α+θ),
  cognitiveLoad=(ch1Load+ch2Load)/2, totalNeuralActivity=(ch1+ch2)/2, faa=ln(α_fp2)−ln(α_fp1),
  merged 채널(SQI 가중 기하평균)

### 루프 ② mindbreeze EEG 대조 — 핵심 차이 5건
| 항목 | haru | mindbreeze(전) |
|------|------|---------------|
| 채널 | merged | ch1 단일 |
| 스케일 | raw | ×100 (이중 정규화) |
| cognitiveLoad | (θ+α+β+γ)/2 | θ/α |
| totalNeuralActivity | (ch1+ch2)/2 | ch1 합 |
| faa | 있음 | 없음 |

### 루프 ③ haru PPG 분석
- RR interval 200~2000ms 필터, SDNN/RMSSD는 RR에서 time-domain 계산

### 루프 ④ mindbreeze PPG 대조
- RR interval 필터 300~1500ms (haru와 불일치)

### 루프 ⑤ 수정 (Orca codex)
- EEG: merged 채널 + ×100 제거 + cognitiveLoad/totalNeuralActivity 공식 교체 + faa 추가
- PPG: RR interval 200~2000ms 통일

## 검증
- mindbreeze calculateRawIndices가 haru 정본과 수식 완전 일치 확인
- `npm run build` 0 error
- 커밋 `672b117` → Deploy Dev `34810782430` 성공

## 근본 원인 (요약)
집중도/이완도 100 포화 = raw 지표 ×100 + SDD-036 sigmoid 정규화의 **이중 정규화**.
스트레스 단위 불일치 = cognitiveLoad 공식(θ/α vs load 평균) + 채널(단일 vs merged) 차이.
