# SDD-317 verify — 사전등록 (구현·홀드아웃 접근 전에 확정, 사후 변경 금지)

작성: 2026-11-06, 구현 코드 작성 전. 변경이 필요하면 새 버전 파일(`verify-v2.md`)로 추가하고 이 파일은 남긴다.

## V1. 데이터 분할 (사전등록, 시드 317)
| 세트 | 구성 | 용도 |
|---|---|---|
| 개발(dev) | BIDMC 53명 전체 · MARSH 15명 · MIMIC PERform non-AF 16 + AF 19 · PPG-DaLiA S1·S15 | 하네스 개발·기준선 C0 |
| 홀드아웃(holdout) | MARSH 14명 · CapnoBase 42건 | 알고리즘 동결 후 단 1회 |

- MARSH 분할 규칙: 피험자 ID(폴더명)를 `sha256("ppg-eval-v1:marsh:" + id)` 16진 오름차순으로 정렬해 앞 15명=dev, 뒤 14명=holdout. 결과는 `tools/ppg-eval/splits.json` 에 고정(파일 sha256 을 결과 메타에 기록).
  - dev: 0037, 2655, 0083, 5377, 5757, 8623, 0048, 0018, 4301, 3029, 5329, 1707, 1000, 8722, 4909
  - holdout: 0256, 8000, 0017, 1436, 5111, 0047, 5600, 0023, 3723, 7113, 0214, 0005, 0046, 1337
- 분할 단위는 **피험자(기록)** 이며 한 피험자의 어떤 창도 두 세트에 걸치지 않는다(시험으로 검증).
- MIMIC PERform·BIDMC 은 환자 식별자가 공개되지 않아 서로의 환자 중복 여부를 확인할 수 없다 → 한계로 기록.
- PPG-DaLiA 는 움직임 강건성 별도 층(HR 전용, 호흡 참값 없음).
- 호흡 층 제외: MIMIC PERform(호흡 이벤트 주석 없음), PPG-DaLiA(파형만).

## V2. 호흡 참값 산출 규칙
- 이벤트: BIDMC=주석자1·주석자2 breath 샘플 번호(125Hz). MARSH=`IP_annot`(흡기 끝 국소 최대, IP 250Hz 인덱스) — 주 참값. NASAL 은 사용하지 않는다(보조 확인 안 함, 사유: 샘플률 미확정). 범위를 벗어난 주석(신호 길이 초과)은 제거하고 개수를 기록.
- 채점 시각 T: 기록 시작 후 **10초 간격**(T = L, L+10, …). 창은 (T−L, T], L ∈ {30, 60, 120}초, **주 지표는 L=60**(코어 최소 창과 같음), 30·120 은 민감도.
- 창 참값(회/분) = 창 안 이벤트 k개(k≥3)의 `60·(k−1)/(t_k − t_1)`(간격 기반). 경계 처리: 첫 이벤트가 창 시작으로부터, 마지막 이벤트가 T 로부터 각각 해당 창 중앙 호흡 간격의 1.5배를 넘으면 참값 **정의 불가** → 그 창은 채점 대상(분모)에서 제외하고 `truth_undefined` 로 개수만 기록. 보조 참값 `count_rate = 60·k/L`.
- BIDMC 주석자 2명: 두 참값이 모두 정의되고 |a1−a2| ≤ 3 회/분이면 평균을 참값으로, 3 초과면 `annotator_disagree` 로 제외(제외 개수 보고). 한 명만 정의되면 제외.
- 호흡 속도 층: 참값 기준 <6, 6–12, 12–20, >20 회/분(경계는 하한 포함 `[a,b)`).
- MIN 코어 최소 창이 60초이므로 L=30 의 코어 출력은 항상 60초 이상 RR 로 계산됨을 보고서에 명시.

## V3. 지표 정의 (호흡)
코어 값 = 시각 T 이하 가장 최근 emission 의 `respiratory_rate`(null 이면 결측). emission 은 코어가 50샘플마다 1회 내므로 T 시각 emission 과 정확히 같다.
- **coverage = 코어 값이 있는 채점창 수 / 참값이 정의된 모든 채점창 수** (분모에 null 창 유지). 오차 지표는 값이 있는 창에서만 계산하되 항상 coverage 와 함께 표시. 오차표에서 null 을 빼는 것으로 MAE 가 좋아 보이지 않게 하기 위해 **"null 을 최악 오차로 채운 MAE(`MAE_pen`)"도 병기**(사전등록: null 창의 오차 = 고정 12회/분).
- 오차 e = 코어 − 참값. MAE, 중앙절대오차, bias(평균 e), Bland-Altman LoA(bias ± 1.96·SD(e)), p95|e|, 오차≤2 비율(CP2).
- 첫 유효값 지연 = 기록 시작부터 코어 호흡 값이 처음 non-null 이 되는 시각(초), 기록별. 중앙값/분포 보고.
- 1초 점프: 연속 emission 의 |Δ호흡| > 4 회/분 비율(둘 다 non-null 인 쌍 분모).
- 집계: 기록별 지표 → 데이터셋 요약은 **창 풀링**(주) 및 **기록별 평균의 평균**(보조). 신뢰구간은 아래 V6.
- 가설 측정(코어 수정 없이): (H1) 프레임별 정제로 제거된 RR 비율 = (후보 중 범위 밖/게이트 탈락/소급 제거된 수)/(후보 수). 시간 압축률 = RR 버퍼 합 / 버퍼 첫~끝 박동 시각 차. (H2) Welch 구간 중 NaN 포함 비율 = 호흡 계산 시 4Hz 재표본의 NaN 점이 포함된 Welch 구간 수/전체 구간 수. (H3) 참값이 탐색 대역 0.15–0.4Hz(9–24회/분) 밖인 채점창 비율. 모두 호흡이 계산되는(RR 버퍼≥30, RR합≥60s) 프레임/창 기준.

## V4. 지표 정의 (박동·HR·HRV)
- 참값 박동: ECG R-peak. MARSH=수기 `ECG_annot`. BIDMC·MIMIC·DaLiA=ECG 파형에서 검출(고정 알고리즘: 5–25Hz 대역통과 → 제곱 → 이동적분 → 적응 임계/불응기 200ms, 구현은 코드에 고정) — **참값 품질은 MARSH 수기 주석 대비 검출기 F1 로 먼저 측정해 보고**하고, F1<0.98 이면 해당 값을 신뢰도 한계로 표기.
- 코어 박동 후보: `PpgResult.rr_end_ts`(HRV 경로의 피크 종료시각)를 샘플 인덱스로 환산해 시각화, 중복 제거. (코어가 양방향 피크 경로를 따로 가지므로 HR 표시용 경로는 박동 시각이 노출되지 않음 → HR 은 별도로 코어 `heart_rate` 와 ECG HR 비교.)
- 지연 보정: 기록별 상수 lag = 매칭된 (코어 피크 − 선행 R) 의 중앙값(맥파 도달 시간). 이후 허용오차 **±100 ms** 로 1:1 greedy 매칭(가까운 순). beat precision, recall, F1. 최종 PPI 오차 = 매칭된 연속 박동쌍의 (코어 PPI − ECG RR) 의 평균·SD·|오차| 평균(ms).
- HR: 채점 시각 T 의 코어 `heart_rate`(EMA 평활된 표시값) vs ECG 평균 HR(창 L=30초, 같은 T) → MAE(bpm), bias, coverage.
- SDNN·RMSSD: T 의 코어 `sdnn`, `rmssd`(코어 창 정의) vs ECG RR 로 계산한 같은 정의(코어와 동일한 최근 60RR/30.5초 창, 모집단 SDNN, RMSSD 분모 N−1) 값. 편향(절대·상대), LoA. 코어가 null 이면 coverage 에서 분모 유지. ECG 참값은 PRV 와 같은 양이 아님(PPG 는 PRV) — 해석 주의 문구를 표에 붙임.
- 이소성/AF(MIMIC AF 19건)는 별도 층으로 보고.

## V5. 변환·코어 호출 계약
- 50Hz 변환: 원 샘플률 f 에서 `scipy.signal.resample_poly(x, 50/g, f/g)`(g = gcd, Kaiser 기본 창, anti-alias 포함). 필터·리샘플 설정 문자열을 `CONVERT_VERSION = "resample_poly-kaiser5.0-v1"` 로 결과에 기록.
- IR 스케일(고정, 기록별): `ir = round(1_150_000 + (x − mean(x))·g)`, `g = 70 / std(sosfiltfilt(butter(2,[1,5],fs=50), x))`, uint24 범위로 클립(클립 수 기록). 근거: s317 실기기 IR 평균 1.15M, 1–5Hz AC std ≈ 69. red = ir 복제.
- 패킷: 50샘플/패킷(헤더 u32 LE = 마지막 샘플 tick, tick=round(sample_idx·32768/50)), 샘플 6바이트(red BE24, ir BE24), 도착시각 = 패킷 종료 시각(정확히 실시간 간격), 코어 기본 설정(`CoreConfig::default()`, `SampleClock`). 코어는 수정하지 않고 `Core::push_packet` 만 호출.
- 빌드 SHA: 하네스 실행 시 `git rev-parse HEAD`, `git status --porcelain packages/measurement-core/src` 비어 있음을 결과에 기록(비어 있지 않으면 실행 거부).

## V6. 통계
- 신뢰구간: **기록(피험자) 단위 cluster bootstrap** 95% CI(percentile), B=2000, 시드 317, numpy `Generator(PCG64(317))`. 기록 재표본 후 그 기록의 모든 채점창을 포함. 창 단위 bootstrap 금지.
- 층별 표(호흡 속도 4층): 층별 기록 수 n_rec, 창 수 n_win 병기. **n_rec < 10 이면 "CI 넓음 — 해석 주의" 경고를 표에 붙인다.** n_rec < 3 인 층은 값 대신 "표본 부족"으로 표기.
- 다중 비교 없음(기준선만 측정). 후보 비교는 이 SDD 범위 밖.

## V7. 하네스 합격 조건 (이 SDD 의 합격 = 아래만. 정확도 합격선 없음)
| # | 항목 | 검증 방법 | 허용오차/기준 |
|---|---|---|---|
| H1 | 재현성 | 같은 dev 입력·시드로 `run-dev` 2회, 모든 결과 파일 sha256 비교 | 바이트 동일 |
| H2 | 입력 변환 독립 교차 | 샘플 1건(BIDMC 1건)을 순수 numpy 독립 구현(스케일·패킷화 재작성, 코어 디코더와 무관하게 바이트 해독)으로 재계산 | 디코드한 IR 과 독립 계산값 |Δ| ≤ 1 count; 코어 박동 후보가 독립 필터 신호 국소 최대와 ±2샘플 이내 ≥ 95%; 코어 HR 중앙값이 독립 피크 HR 중앙값과 ±3 bpm |
| H3 | 참값 산출 단위 시험 | 합성 이벤트열(알려진 주기·경계·결측)로 규칙 V2 검증 | 정확히 기대값 |
| H4 | 지표 단위 시험 | 손계산 가능한 소규모 벡터로 MAE·bias·LoA·p95·coverage·`MAE_pen`·F1 | 기대값 일치(1e-12) |
| H5 | 분할 누수 | splits.json 이 규칙으로 재생성되는지, dev∩holdout=∅, 전 기록 포함 | 위반 0 |
| H6 | 홀드아웃 잠금 | 플래그 없이 holdout/capnobase 접근 시 예외, 접근 시도 로그 기록; dev 실행 로그에 holdout 접근 0건 | 위반 0 |
| H7 | 코어 불변 | `git diff --stat origin/develop -- packages/measurement-core/src` 비어 있음; `cargo test --release` 통과 수가 변경 전 기록(65 통과·0 실패)과 동일 | 동일 |
| H8 | 기준선 문서화 | `results/baseline-c0.md` 에 V3·V4 표와 가설 H1–H3 수치 | 존재 |
| H9 | 그림자 일치 | 예제 안 RR 버퍼 거울 구현의 길이가 코어 `rr_buffer_len` 과 매 emission 일치 | 불일치 프레임 0 — 불일치가 있으면 H1–H3 가설 지표를 "불확실"로 표기 |

## V8. 홀드아웃 절차 (이번 SDD 에서는 실행하지 않음)
1. 대표가 알고리즘을 동결(코어 SHA 확정, `git status` clean).
2. `python -m ppg_eval.cli run-holdout --unlock-token <동결 SHA> --confirm-single-run` 를 **한 번**만 실행.
3. 실행기는 `results/holdout-run.json` 에 커밋 SHA, splits.json·verify.md 해시, 데이터 MANIFEST 해시, 시각, 결과 해시를 기록하고, 이미 존재하면 재실행을 거부한다.
4. 이후 알고리즘 수정 금지. 수정하면 새 SDD 로 간주하고 홀드아웃은 소진된 것으로 표기.
- 개발 중 홀드아웃 데이터를 여는 코드 경로는 위 플래그 없이는 예외를 낸다(H6).
