# SDD-317 summary — PPG 정확도 검증 하네스 (개발 세트 기준선 C0)

- 브랜치 `sdd/317-ppg-accuracy-harness`, 기준 `origin/develop` b7c6dbd18b00eddd8b53b7b9659b5ee2d2fb28a0. 코어 `src` 트리 해시 `4d5ced0ff300f005308e785f2a67b060ac642528`(변경 없음).
- 상세 수치: `tools/ppg-eval/results/baseline-c0.md` (= `results/dev/`). 이 문서는 요약.
- 범위: 개발 세트(BIDMC 53, MARSH 15, MIMIC non-AF 16 + AF 19, DaLiA S1·S15)만. **홀드아웃(MARSH 14명, CapnoBase 42건)은 열지 않았다.**

## 1. 기준선 (창 60초, 채점 hop 10초, 참값 정의 창 기준)
| 데이터셋 | 층(참값 회/분) | 기록 n | 창 n | coverage | MAE (95% CI) | bias | 비고 |
|---|---|---|---|---|---|---|---|
| BIDMC | 전체 | 53 | 2194 | 79.9% | 5.41 (4.54–6.34) | −4.42 | MAE_pen 6.74 |
| BIDMC | 6–12 | 3 | 60 | 88.3% | 2.29 | +1.66 | CI 넓음 |
| BIDMC | 12–20 | 46 | 1764 | 78.3% | 4.83 (4.05–5.64) | −3.96 | |
| BIDMC | >20 | 17 | 348 | 84.8% | 8.63 (5.95–10.98) | −8.47 | |
| BIDMC | <6 | 1 | 22 | 100% | 6.18 | +6.18 | 표본 부족 |
| MARSH dev | 전체 | 15 | 1190 | 98.2% | 3.07 (2.50–3.65) | −0.69 | MAE_pen 3.22 |
| MARSH dev | 6–12 | 15 | 517 | 99.2% | 2.26 (1.81–2.77) | +1.84 | |
| MARSH dev | 12–20 | 15 | 560 | 97.0% | 2.54 (2.00–3.18) | −1.33 | |
| MARSH dev | >20 | 14 | 112 | 100% | 9.33 (8.08–10.38) | −9.23 | |
| MARSH dev | <6 | 1 | 1 | – | – | – | 표본 부족 |

- 첫 유효 호흡값 지연 중앙값: BIDMC 64초, MARSH 65초. BIDMC 7건은 8분 내 유효값이 아예 없거나 매우 늦음(최대 394초).
- 1초 점프 >4회/분: BIDMC 2.76%, MARSH 0.83%.
- 박동(±100ms, 블록별 지연 보정) F1: MIMIC non-AF 0.943, MIMIC AF 0.912, BIDMC 0.822(ECG≈모니터HR 기록 46건 0.857), MARSH 0.835(ECG 주석 신뢰 10명 0.910), DaLiA 0.703. PPI 오차 SD 기록 중앙값 15~48ms.
- HR MAE: MIMIC non-AF 2.0, MARSH 2.3, BIDMC 10.2(신뢰 기록 8.5), AF 10.1, DaLiA 8.6 bpm.
- SDNN/RMSSD(코어 PRV − ECG HRV): 데이터셋마다 부호·크기가 크게 다르다(예: MARSH 신뢰 기록 −8.9/−5.8ms, MIMIC non-AF −10.3/−13.3ms, AF −72.7/−97.2ms, DaLiA +18.4/+51.3ms). PPG PRV 와 ECG HRV 는 같은 양이 아니라서 정확도 결론으로 쓰지 않는다.

## 2. 가설 3종 (코어 수정 없이 측정)
| 가설 | 결과 | 해석 한계 |
|---|---|---|
| H1 정제로 제거된 RR / 시간축 압축 | 제거 RR 비율 BIDMC 8.6%, MARSH 5.5%. 버퍼합/시각차 BIDMC 0.877, MARSH 0.947 (1이면 압축 없음) | 발생 빈도만 측정. 호흡 오차에 대한 인과는 ablation(A1/A2) 필요 — 범위 밖 |
| H2 Welch 마지막 구간 NaN | 호흡 계산 프레임의 BIDMC 63.9%·MARSH 69.9%에서 NaN 포함 Welch 구간이 있고, 전체 Welch 구간의 22.9%·25.4% | 동일 |
| H3 참값이 탐색대역(9–24회/분) 밖인 창 | BIDMC 3.8%, MARSH 18.9% | 대역 밖 창에서의 코어 출력은 `resp-windows.csv` 로 별도 분석 가능 |
- 거울 구현 신뢰성: 거울의 RR 버퍼 길이와 코어 `rr_buffer_len` 불일치 프레임 0/98,174.

## 3. 합격 조건 점검 (verify.md V7)
| # | 항목 | 결과 |
|---|---|---|
| H1 | 재현성 | `repro.sh`: run-dev 2회, 결과 파일 7종 sha256 동일 (`results/repro-hash.txt`) |
| H2 | 독립 교차 | BIDMC 01: 디코드 IR 이 독립 구현과 ±1 이내(시험 통과), 박동 ±40ms 일치 99.7%(코어-독립 필터 지연 −20ms), HR 91.0 vs 89.6 |
| H3~H6 | 단위 시험 | pytest 18건 통과 |
| H7 | 코어 불변 | `src` diff 0줄, `cargo test --release` 전 65 통과·0 실패 / 후 65 통과·0 실패 |
| H8 | 기준선 문서화 | `results/baseline-c0.md` |
| H9 | 거울 일치 | 불일치 0 |

## 4. 사전등록 이후 보완 (addendum 1~7, 모두 기준선 산출 전 커밋)
verify.md 는 d82c2238 이후 불변(diff 0). 아래 7개 보완은 별도 파일. 일부(5·6·7)는 dev 시험 실행 결과를 본 뒤 작성했으므로 **선택 편향 가능성**을 공개한다.
- addendum 5: 박동 지연이 기록 안에서 흘러(0.6→1.5s) 30초 블록별 지연으로 변경.
- addendum 6: MARSH dev 5명(0083, 3029, 4301, 4909, 5377)은 ECG 파형과 수기 주석이 불일치 → 박동·HR·HRV '신뢰 기록만' 행에서 제외. 호흡 층은 영향 없음. 전 기록 행도 항상 병기.
- addendum 7: BIDMC 7건(04, 26, 32, 33, 39, 40, 53)은 ECG 검출 HR 이 모니터 HR 과 10% 이상 달라 같은 방식으로 분리.

## 5. 한계·미확인
- 공개 PPG 는 손가락·귀·손목이다. LINK BAND 이마 반사형 정확도가 아니다.
- 6–12회/분 층의 BIDMC 표본은 3명(CI 넓음), <6 층은 1명이라 해석 불가. 느린 호흡 평가는 MARSH(15명) 에 의존.
- MARSH 샘플률: 논문이 PPG 500Hz·IP 250Hz 로 명시, 데이터상 4명(0018·0046·0047·0048)은 PPG 샘플 수가 ECG 와 같아 250Hz 로 처리 — 논문 본문에 이 4명의 예외 언급은 확인 못 함(길이 일치로 추정).
- BIDMC·MIMIC 환자 중복, MIMIC PERform `_fix.txt` 의 내용, DaLiA 라이선스는 확인 못 함. MIMIC 은 호흡 이벤트가 없어 호흡 층 제외. 자체 회차(d38140c8 등)는 정확도 평가에 쓰지 않음(교차 확인은 s317 scratch 의 IR 통계로만 스케일 근거).
- 박동 F1 은 ECG 참 박동(검출기) 품질에 묶인다. MIMIC 에는 모니터 HR 이 없어 게이트를 적용하지 못했다.
- 코어는 HR 표시용 피크 경로의 박동 시각을 노출하지 않아 박동 F1 은 HRV 경로(`rr_end_ts`) 기준이다.
- 정확도 합격선은 이 SDD 의 합격 조건이 아니며 판정하지 않았다.

## 6. 개선 후보 (코드 변경 없음, 후속 SDD 용 — 효과는 미확인)
1. 호흡 값이 전혀 없는 BIDMC 7기록 원인 분석(정제 소진·재시드 여부) — `records.csv` 의 `reseeds`, `resp_calc_frames` 참고.
2. 마지막 Welch 구간 NaN 제거(A1), 시간축을 `rr_ts` 기준으로 보존(A2) — 각각 단독 ablation.
3. 탐색 대역 하한(0.15Hz) 완화 — MARSH 에서 6–12회/분 bias +1.84, >20 층 bias −9.2 로 양쪽 끝이 편향.
4. >20회/분 층의 큰 음의 편향(BIDMC −8.5, MARSH −9.2): 대역 상한(0.4Hz=24회/분) 또는 피크 선택 문제 후보.
5. 박동 검출: 50Hz 격자 20ms 지터 → 포물선 보간, HR/HRV 피크 경로 통합.
- 후보 평가는 홀드아웃 동결 후 1회 원칙을 지킨다(verify.md V8).

## 7. 재현 명령
```bash
cd tools/ppg-eval && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
export PYTHONPATH=.
.venv/bin/python -m ppg_eval.cli run-dev --out results/dev
.venv/bin/python -m pytest tests -q
./repro.sh
cd ../../packages/measurement-core && cargo test --release --offline
```
- 홀드아웃 접근 증거: `tools/ppg-eval/results/access-log-dev.jsonl` — dev 기록 465건 열람, holdout 접근 0건.
