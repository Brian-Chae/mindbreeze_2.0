# Summary — LF/HF 과대 산출 수정 (2026-11-13, 로컬 커밋, 푸시·배포 없음)

결정(대표 "추천대로"): 평균(선형 detrend) 제거 + cubic 보간 포함, HF 확장 보정 제거. PR #303(RMSSD)은 develop 머지 완료 → 이 브랜치를 origin/develop에 rebase 후 작업. 저장값은 `recompute_ppg_hrv.py` 제자리 덮어쓰기(엔진 재빌드만, 도구·스키마 변경 0).

## 1. 수정
- TS `frontend/src/lib/eeg/AnalysisMetricsService.ts`: `resampleRRIntervals`(박동 중점 기준 자연 3차 스플라인 → 4Hz → 선형 detrend), 신규 `interpolateCubicSpline`·`detrendLinear`, HF 확장 보정 삭제(`calculateFrequencyDomainMetrics`). 호흡수 경로도 같은 재표본 사용.
- Rust `packages/measurement-core/src/dsp/hrv.rs`: `resample`·`interpolate_cubic_spline`·`detrend_linear` 추가, `freq_domain`의 HF 확장 보정 삭제.
- WASM 재생성(`measurement_core_bg.wasm`, js/d.ts 불변). 골든 oracle·legacy_fallback·manifest 재생성(HRV 단계 해시만 변경). 재산출 엔진 `examples/recompute_ppg_hrv.rs`는 코어 `process_ppg`를 그대로 호출하므로 새 계산을 자동 사용(소스 변경 없음, 서버에서 재빌드 필요).
- 신규 테스트 `frontend/tests/fix-lfhf-detrend.test.ts`(B1·B2·B3·B5·B6). 수정 전 코드에서 B1·B3·B6 실패(RED) 확인.

## 2. 하네스 전/후 (원시 PPG 53명, 서비스 코드 그대로 재생 49명, 사람별 중앙 → 전체 중앙)
| 지표 | 수정 전 | 수정 후 | 재계산 |
|---|---|---|---|
| LF/HF | 2.50 | 0.96 | 1.11 |
| 재계산과 ρ(LF/HF) | 0.64 | 0.84 | – |
| RMSSD(ms) | 32.30 | 32.30 | 36.7 |
| SDNN(ms) | 35.78 | 35.78 | 51.9 |
| HR | 66.0 | 66.0 | 64.4 |
- RMSSD·SDNN·HR는 49명 전원 소수 4자리까지 불변(최대 차 0).
- 회차별(LF/HF 중앙 / ρ): b1(8명) 0.50/0.26, b2(28명) 1.38/0.91, m(13명) 0.58/0.79.
- 판정: 중앙 0.9~1.3 ✔(0.96), ρ ≥ 0.85 ✘ **0.84(0.01 미달)**, RMSSD·SDNN·HR 불변 ✔. 회차별 ρ ≥ 0.8은 b1(소표본 8명)에서 미달 — verify A3 미충족.
- 파이썬 절제 포트 예측(중앙 1.06, ρ 0.90)과 실제 서비스 재생(0.96, 0.84)의 차이는 EMA 평활·틱 간격 때문이며 방향은 일치.

## 3. 테스트
| 명령 | 결과 |
|---|---|
| `cd frontend && npx vitest run tests/sdd244 tests/sdd246-web tests/sdd273 tests/fix-ppg tests/fix-rmssd-zero-phase.test.ts tests/fix-hrv-sdnn-scale.test.ts` | 37 파일 통과 / 270 테스트 (1 skip) |
| `npx vitest run tests/fix-lfhf-detrend.test.ts` | 5/5 |
| `cd packages/measurement-core && cargo test --offline` | 전부 ok (golden_oracle 4/4 재생성 후, engine_invariants 10 포함) |
| `ORACLE_WRITE=1 vitest ... vitest.oracle.config.mjs` (biquad / legacy_fallback) + `build_manifest.py build/check` | 33 / 32+1skip, manifest OK(177) |
| `backend pytest tests/test_fix_hrv_recompute.py tests/test_sdd036_hrv_motion.py tests/test_sdd027_rollup_raw_report.py` | 36 passed |

## 4. 앱 재빌드
네이티브 앱 재빌드 필요(Rust 코어 변경, Android .so / iOS xcframework). 웹은 프런트 배포로 반영.

## 5. 리포트의 LF/HF 노출 (코드 검색 결과, 변경 없음)
- `backend/app/tasks/report_task.py:343-345` 타임라인에 `lf_power/hf_power/lf_hf_ratio` 값 포함(수업 흐름 시계열).
- `backend/app/services/eeg_rollup_service.py:36-38,77` 롤업에 `lf_hf_ratio` 평균 파생.
- `backend/app/services/report_narrative.py:194` 사용자 문구 금지어에 "LF/HF" — 서사에 노출하지 않음. `summary_task.py:162` AI 요약 프롬프트도 LF/HF 용어 금지.
- 절대값 판정·참고 범위 문구는 제품 리포트 코드에서 찾지 못함. 내보내기(`export_package.py`, `data_center_export.py`, `research_export_service.py`)는 단위 `ratio`로 원값 노출 — 연구용.
- 프런트 `trend-metric-keys.ts:19` 플레이그라운드 추이 키(추이 표시).

## 6. 결정 필요
1. verify A2(ρ≥0.85) 0.84 · b1 회차 ρ 미달: 합격으로 볼지, EMA α 완화 등 추가 조정(이번 범위 밖)할지.
2. 연구용 내보내기의 LF/HF 원값에 "추이 참고용" 단서를 붙일지.
3. 서버 재산출은 엔진 재빌드 후 dry-run `windows_unmatched` 확인 순서(RMSSD와 동일)로 실행 승인 필요.
4. Task Force 1996 원문은 이번에도 직접 열람하지 못함(대역 정의 0.04~0.15/0.15~0.4는 기억 기준) — 원문 대조 필요.
