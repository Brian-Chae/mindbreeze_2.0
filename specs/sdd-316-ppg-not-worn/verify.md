# SDD-316 — Verify (구현 전 QA 체크리스트, 2026-11-06 작성)
> 구현 전 작성. 사후 수정 금지(결과는 summary.md 에 기록).
## V1 합성 (cargo test `sdd316_not_worn`)
| # | 시나리오 | 합격 |
|---|---|---|
| V1-1 | 착용(IR 1.4M+맥파 75bpm 40초) → HR/SDNN 값 있음 | 값 산출, reason 없음 |
| V1-2 | 이어서 미착용(IR 5k 평탄) 3초 이내 | 아직 worn 유지(깜빡임 없음) |
| V1-3 | 미착용 3초 이상 | 프레임 bpm/sdnn/rmssd/lf/hf/respiration 전부 value=null, validity=invalid, reason=not_worn, 0 치환 없음 |
| V1-4 | 미착용 진입 직후 RR 버퍼 길이 | 0 |
| V1-5 | 중간 구간(IR 300k) 지속 | 직전 상태 유지(worn→worn, not_worn→not_worn) |
| V1-6 | 복귀(IR 1.4M) 3초 미만 | 계속 not_worn |
| V1-7 | 복귀 3초 이상 후 40초 | warming_up 을 거쳐 valid 재개, 미착용 중 공기값 RR 이 SDNN·호흡에 섞이지 않음(복귀 후 HR 이 착용 파형 bpm ±3) |
| V1-8 | 처음부터 미착용 | 3초 후 not_worn |
| V1-9 | 패킷 분할(1샘플/패킷 vs 25샘플/패킷) | 동일 출력 |
| V1-10 | EEG 지표·motion | 미착용 중에도 영향 없음 |
## V2 실데이터 replay (.pkts)
| # | 항목 | 합격 |
|---|---|---|
| V2-1 | 83a39b18 미착용 구간(진입 3초 이후) | HR/SDNN/RMSSD/호흡 전부 null+not_worn, 값 0건 |
| V2-2 | 1df2153e 미착용 구간(330초~) | 동일 |
| V2-3 | 두 회차 착용 구간(안정 구간) | 수정 전(SDD-314 결과)과 HR 중앙값 일치 ±1 bpm, 값 산출 유지 |
| V2-4 | 구간별 전후 표 | summary 에 첨부 |
## V3 회귀
| # | 항목 | 합격 |
|---|---|---|
| V3-1 | cargo test 전체(golden_oracle·guard_vectors·sdd314 등) | 의도된 변경 외 통과, 바뀌면 diff 표 |
| V3-2 | C ABI(include/*.h)·contracts/ | 변경 없음 |
| V3-3 | 시험 삭제·skip·클램프·null→0 | 없음 |
| V3-4 | 프런트 vitest | 신규 실패 0 (기준선 23fails/13files + sdd220-app-identity 1건), tsc 0, eslint 0 |
| V3-5 | 화면 문구 | null+not_worn → "밴드를 착용해 주세요", 금지 표현 없음, 그 외 null 은 기존 "측정 중" 유지 |
| V3-6 | swift test | 가능하면 실행, 불가 시 사유 기록 |
