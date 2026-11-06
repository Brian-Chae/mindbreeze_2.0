# SDD-317 plan — PPG 정확도 검증 하네스

## 아키텍처
```
원본 데이터(RO) → adapters(Python) → 공통 Record(PPG 원샘플률, 참값 이벤트, 메타)
   → to50hz(anti-alias 리샘플, 버전 고정) → IR uint24 스케일 → 50샘플 패킷 파일(.pkts)
   → Rust example `replay_eval`(코어 실제 push_packet, SampleClock) → 프레임 CSV(1초 간격)
   → evaluator(참값 산출·지표·층별·bootstrap CI) → results/*.csv|json|md
```
- Python: `tools/ppg-eval/ppg_eval/`, venv `tools/ppg-eval/.venv`(gitignore), `requirements.txt` 고정(numpy 2.1.3, scipy 1.14.1, wfdb 4.1.2, pytest 8.3.3).
- Rust: `packages/measurement-core/examples/replay_eval.rs` 신규 1개만. 코어 `src/` 무수정. 빌드 산출물은 `tools/ppg-eval/.cargo-target`(gitignore).
- 패킷 규격: 헤더 u32 LE = 마지막 샘플 tick(32768Hz, 샘플 idx×32768/50 반올림), 샘플 6바이트(red BE24, ir BE24), 50샘플/패킷, 도착시각 = 패킷 번호×1초(monotonic µs), 앵커 = 도착시각. `examples/replay_wear.rs` 와 동일한 `Core::push_packet(Sensor::Ppg, …, WallAnchor)` 경로.
- IR 스케일: 레코드 전체에 **고정 선형 변환** `ir = 1,150,000 + (x − mean(x))·g`, `g = 70 / std(bandpass_1-5Hz(x))`(실기기 AC std≈69, DC≈1.15M 근거: s317 scratch 실측). red = ir 복제(코어의 호흡·HR·HRV 는 IR 만 사용; red 는 SQI·SpO2 용 — 평가 무관). uint24 범위 초과 시 레코드 기록·클립 수 로그.
- 그림자(shadow) 진단: example 안에 `HrvState::update_rr_buffer` 의 후보 중복제거·200–2000ms·중앙값±25% 소급 규칙을 거울 구현해 **매 프레임 코어 `rr_buffer_len` 과 일치하는지 검증**(불일치 프레임 수를 출력). 일치하면 가설 지표(정제 제거율, 시간 압축률, Welch NaN 구간 비율) 신뢰. 코어 수정 없이 가능한 범위이며, 불일치가 있으면 해당 지표를 "불확실"로 표기.

## 모듈
| 파일 | 역할 |
|---|---|
| `ppg_eval/splits.py`, `splits.json` | 사전등록 분할(해시 규칙, 시드 317). 누수 검사 |
| `ppg_eval/guard.py` | 홀드아웃 잠금, 접근 로그(`results/access-log.jsonl`) |
| `ppg_eval/adapters/{bidmc,marsh,mimic,dalia,capnobase}.py` | Record 생성. capnobase 는 잠금 하에서만 열림(개발 중 미구현 스텁+스키마 문서) |
| `ppg_eval/convert.py` | 50Hz 변환, IR 스케일, .pkts 작성 |
| `ppg_eval/core_runner.py` | cargo 빌드 SHA 기록, example 호출, CSV 파싱 |
| `ppg_eval/truth.py` | 호흡 참값 산출, ECG R-peak 검출(원신호 레코드용), 참값 HR/SDNN/RMSSD |
| `ppg_eval/metrics.py` | 호흡·박동·HRV 지표, 층별, cluster bootstrap |
| `ppg_eval/report.py` | CSV/JSON/markdown 생성(결정론) |
| `ppg_eval/cli.py` | `run-dev`, `freeze`, `run-holdout`(잠금) |
| `tests/` | 단위·통합·재현성·누수 시험 |

## Task 순서
1. spec/plan/verify 커밋(홀드아웃 열기 전) 2. splits.json + guard 3. 어댑터(BIDMC·MARSH·MIMIC·DaLiA) 4. 변환·.pkts 5. Rust example + 러너 6. 참값·지표·bootstrap 7. 단위·통합·재현성 시험 8. dev 기준선 실행 → baseline-c0.md 9. 가설 3종 측정 10. cargo test 전후 비교 11. summary.

## 설계 변경(브리프 대비)
- BIDMC·MIMIC 은 ECG R-peak *주석*이 없다(파형만). → 박동 참값은 scipy 기반 단순 R-peak 검출기로 만들고, **MARSH 의 수기 ECG 주석 대비 검출기 F1 을 먼저 측정**해 참값 품질을 문서화한다.
- MIMIC PERform 은 호흡 이벤트 주석이 없으므로 호흡 층에서 제외하고 박동·HRV 층(+AF 별도 층)에만 쓴다.
- 1초 hop 의 중첩 창은 서로 독립이 아니므로, 지표 집계는 hop 10초 채점 창으로 하고 CI 는 피험자 단위 cluster bootstrap 으로만 낸다.
