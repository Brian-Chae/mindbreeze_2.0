# ppg-eval — PPG 호흡·HRV 정확도 검증 하네스 (SDD-317)

현재 `packages/measurement-core` 코어를 **수정하지 않고** 공개 라벨 데이터에 먹여 호흡수·박동·HR·SDNN·RMSSD 기준선(C0)을 재는 오프라인 도구.
사전등록 문서: `specs/sdd-317-ppg-accuracy-harness/{verify.md, verify-addendum-1..7.md}`.

## 한계 (반드시 읽을 것)
- 공개 데이터 PPG 는 **손가락(투과)·귀·손목**이며 LINK BAND 이마 반사형이 아니다. 결과는 "같은 코어를 공개 라벨에 먹인 기준선"이지 LINK BAND 정확도가 아니다.
- 호흡 참값이 있는 건 BIDMC(수기, 2인)·MARSH(임피던스 정점)뿐. 느린 호흡(<12/분) 표본은 BIDMC에서 매우 적다(층별 n 경고 참조).
- 정확도 합격선은 없다. 기준선을 있는 그대로 보고하는 것이 목적이다.
- 홀드아웃(MARSH 14명·CapnoBase 42건)은 `guard.py` 로 잠겨 있으며 이번 SDD 에서 열지 않았다.

## 설치·실행
```bash
cd tools/ppg-eval
python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
export PYTHONPATH=.
.venv/bin/python -m ppg_eval.cli run-dev --out results/dev   # 개발 세트 기준선 (약 2~3분)
.venv/bin/python -m pytest tests -q                           # 단위·통합 시험
./repro.sh                                                    # 재현성: 2회 실행 해시 비교
```
- `run-dev` 는 `packages/measurement-core/src` 가 수정돼 있으면 실행을 거부한다(`core_provenance`). cargo 는 오프라인 빌드(`tools/ppg-eval/.cargo-target`).
- 결과: `records.csv`(기록별), `resp-windows.csv`, `hrv-windows.csv`, `aggregate.json`, `baseline-c0.md`, `run-meta.json`.

## 구조
| 파일 | 역할 |
|---|---|
| `ppg_eval/splits.py`, `splits.json` | 사전등록 분할(해시 규칙, 시드 317), 누수 검사 |
| `ppg_eval/guard.py` | 홀드아웃 잠금·접근 로그 |
| `ppg_eval/adapters/loaders.py` | BIDMC·MARSH·MIMIC·DaLiA 어댑터(pickle 은 numpy 재구성만 허용) |
| `ppg_eval/convert.py` | 50Hz 변환(resample_poly), 극성 판정, IR 스케일, 50샘플 패킷화 |
| `ppg_eval/core_runner.py` | 코어 example 빌드·호출·CSV 파싱 |
| `packages/measurement-core/examples/replay_eval.rs` | 코어 `push_packet` 얇은 재생(유일한 코어 쪽 추가 파일) |
| `ppg_eval/truth.py`, `metrics.py`, `report.py`, `evaluate.py`, `shadow.py`, `rpeak_quality.py` | 참값·지표·부트스트랩·리포트·가설 거울 |
| `tests/` | 단위(H3~H6)·통합(H2) |

## 홀드아웃 동결 절차 (이번엔 실행하지 않음)
verify.md V8. 현재 `run-holdout` 은 어떤 경우에도 거부(exit 2)하며, 해제 경로는 코드에 없다. 대표가 알고리즘을 동결한 뒤 별도 승인으로 해제 구현·1회 실행한다.
