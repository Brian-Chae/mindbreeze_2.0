# SDD-314 — Verify (구현 전 QA 체크리스트, 2026-11-06 작성)

> 구현 전 작성. 사후 수정 금지(결과는 summary.md 에 기록). 정본 = link-band-sdk-web (PPGSignalProcessor.ts · AnalysisMetricsService.ts).

## 입력
- dev 회차 83a39b18 PPG 원문 패킷(MBRAW002 packets 섹션) — 62c5fe4b(Android 추정, 191청크) / 8d857524(iOS 추정, 192청크). scratch: `~/.hermes/cache/scratch/sdd314/` (저장소 밖, 커밋 안 함)
- 비교 대상: ① 웹 TS 처리(node) ② Rust 코어 replay(수정 전/후) ③ 앱이 실제 저장한 feature(eeg_feature_windows)

## V0. replay 신뢰성(수정 전)
| # | 항목 | 합격 |
|---|---|---|
| V0-1 | 수정 전 Rust replay 의 SDNN/호흡 null 비율이 DB 저장 feature 와 같은 경향(Android 100% null, iOS SDNN 유효) | 방향 일치 |
| V0-2 | iOS 사용자 HR/SDNN/RMSSD 중앙값이 DB 값과 ±10% | 일치 시 replay 신뢰 |

## V1. 실데이터 합격 기준 (브리프 §합격 기준)
| # | 항목 | 합격 |
|---|---|---|
| V1-1 | Android(62c5fe4b) SDNN·호흡 null 비율 | 웹이 값을 내는 창의 ≥90% 에서 Rust 도 값 산출 |
| V1-2 | 두 사용자 HR 중앙값 | 웹 대비 ±3 bpm |
| V1-3 | 두 사용자 SDNN·RMSSD 중앙값 | 웹 대비 상대차 ±15% (목표) |
| V1-4 | 호흡수 중앙값 | 웹 대비 ±2 회/분 (목표) |
| V1-5 | 미달 시 | 미달 사유와 현재 수치를 summary 에 솔직히 기록 |

## V2. 합성 신호 단위 시험 (cargo test 추가)
| # | 시나리오 | 합격 |
|---|---|---|
| V2-1 | 60/90/120/150/180 bpm 정현 맥파 5분 | 각 bpm 에서 HR ±3, SDNN 산출(null 아님, 동일 입력에서 SDNN 작음 <30ms), 호흡수 산출 |
| V2-2 | 짧은 RR(평균 <500ms) 에서 고정 개수 상한과 시간조건 충돌 없음 | 150·180bpm 에서 SDNN·호흡 모두 값 |
| V2-3 | 이중 피크(2차 숄더) 주입 | RR 이 반으로 붙지 않음(중앙값 RR 이 기본 주기의 ±10%) |
| V2-4 | 갭(수 초 무데이터)·시각 도약 | panic 없음, 이후 회복, 0 치환 없음 |
| V2-5 | 호흡 변조(0.25Hz = 15회/분, 진폭변조/RSA) | 호흡수 15 ±2 |

## V3. 회귀
| # | 항목 | 합격 |
|---|---|---|
| V3-1 | `cargo test` 전체(기존 golden_oracle 등) | 의도된 변경 외 통과. golden 변경 시 diff 표로 무엇이 왜 바뀌는지 문서화 |
| V3-2 | contracts/·ABI(include/*.h)·cbindgen 산출 | 변경 없음 |
| V3-3 | 시험 삭제·skip·값 클램프·null→0 | 없음 |
| V3-4 | WASM/TS 경로 | TS 무수정, 같은 알고리즘이면 일관성 확인 |

## V4. EEG 간이 대조 (1회)
웹(Morlet7+PSD) 대 Rust 밴드파워/지표를 같은 EEG 입력에서 비교, 표로 기록. 차이 큰 경우 수정하지 않고 별도 보고.

## V5. 추가 확인(보고만, 수정 없음) — ACC 샘플 83~87%
ACC 실제 샘플률 vs 코어 30Hz 가정, raw 청크 sample_count 산정, 영향 범위(움직임 지표).

## 보고
수정 파일·커밋 sha, 전후 수치표, 시험 숫자, golden 변경, 앱 재빌드 필요 여부, 못 한 것.
