# SDD-317 — PPG 호흡·HRV 정확도 검증 하네스 (공개 라벨 데이터)

- 상태: Stage ① Spec
- 브랜치: `sdd/317-ppg-accuracy-harness` (기준 `origin/develop` b7c6dbd18b00eddd8b53b7b9659b5ee2d2fb28a0)
- 작성일: 2026-11-06
- 입력 문서: `~/.hermes/share/briefs/{dev-317-ppg-harness,result-318-ppg-upgrade-plan,result-319-literature,result-319-datasets}.md`

## 1. 무엇을 왜
현재 LINK BAND 코어(`packages/measurement-core`)의 PPG **호흡수·박동 검출·HR·SDNN·RMSSD**가 얼마나 맞는지 알지 못한다.
"호흡수가 틀렸다"는 전제는 철회됐다. 이 SDD는 **알고리즘을 바꾸지 않고**, 참값이 있는 공개 데이터로 현재 코어(C0)의 기준선을 논문처럼 재현 가능하게 잰다.
개선(P2~)은 범위 밖이며, 개선 후보는 summary 에 "후보"로만 기록한다.

## 2. 측정 대상
| 대상 | 코어 출력 | 참값 |
|---|---|---|
| 호흡수 (회/분) | `HrvSnapshot.respiratory_rate` + null reason | 수기/임피던스 호흡 이벤트(BIDMC 주석자 2명, MARSH IP 정점) |
| 박동 검출 | `PpgResult.rr_end_ts` 로 복원한 박동 시각 | ECG R-peak (MARSH 수기 주석, 그 외 ECG 파형에서 검출) |
| HR | `HrvSnapshot.heart_rate` | ECG 기반 HR |
| SDNN / RMSSD | `HrvSnapshot.sdnn/rmssd` | ECG RR 기반 같은 지표 |
| 착탈 불변 | SDD-316 시험이 담당. 하네스는 코어 시험이 변경 전후 동일함만 확인 | — |

## 3. 데이터 (읽기 전용)
`/Volumes/Looxid SSD/looxid/datasets/ppg-validation/` — BIDMC, MARSH, MIMIC PERform, PPG-DaLiA(S1·S15), CapnoBase(홀드아웃).
- MARSH 샘플률 확정(근거): 논문(Pirhonen & Vehkaoja 2020, BSPC)이 "PPG 500 Hz", "IP 250 Hz" 로 명시. 데이터상 ECG·IP 는 전 피험자 250 Hz(길이 일치). PPG 샘플 수가 ECG 의 2배(25명)면 500 Hz, 1배(0018·0046·0047·0048)면 250 Hz 로 처리 — 두 경우 모두 PPG 길이/fs 가 ECG 길이/250 과 0.2% 이내로 일치.
- 공개 데이터 PPG 는 이마 반사형이 아니라 **손가락(투과)·귀·손목**이다. 일반화 한계로 README·summary 에 명시.

## 4. 범위 밖
코어 알고리즘 수정, 앱·프론트 변경, 푸시·PR·배포, 운영/dev DB, 자체 회차의 정확도 평가(참값 없음 — 코어 대 하네스 재현성 확인에만 사용), 정확도 합격선(MAE 2회/분 등은 *목표*일 뿐 이 SDD 합격 조건 아님).

## 5. 합격 (하네스 자체)
1. 같은 입력·시드에서 결과 파일 바이트 동일.
2. 코어 호출 경로 입력 변환이 독립 numpy 구현과 교차 일치(사전 정의 허용오차).
3. 단위 시험 통과(참값 산출·지표·분할 누수 없음·홀드아웃 잠금).
4. `cargo test` 결과가 변경 전후 동일(코어 src diff 0).
5. 기준선(C0) 수치가 `tools/ppg-eval/results/baseline-c0.md` 에 문서화.
6. 홀드아웃은 열지 않음(동결 절차만 준비).
