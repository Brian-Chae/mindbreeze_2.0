# Summary — 서비스 RMSSD 과대 산출 수정 (2026-11-13, 로컬 커밋, 푸시·배포 없음)

결정(대표): 알고리즘을 고치고 **저장값은 새 알고리즘으로 제자리 덮어쓴다. 버전별 사본·컬럼·테이블 없음(마이그레이션 0).**

## 1. 원인 (확정) 과 수정
- 원인: 단방향(causal) 1~5Hz 필터의 주파수별 군지연 → 박동 시각이 박동마다 흔들림(주 요인) + 창 끝 불완전 박동이 처음 검출된 시각으로 고정(`AnalysisMetricsService` 중복 제거는 먼저 온 시각 확정). 포물선 보간 없음(양자화는 부차: +2~3ms).
- 수정(TS·Rust 동시):
  1. RR 검출 입력 영위상 필터(정·역방향, 가장자리 홀대칭 패딩 100샘플) — `frontend/src/lib/eeg/PPGSignalProcessor.ts` `applyZeroPhaseFilter`, `packages/measurement-core/src/dsp/biquad.rs` `ppg_filter_zero_phase`. HR·SQI·SpO2 입력 필터는 그대로.
  2. 창 끝 50샘플(1초) 안에서 닫는 피크는 RR 확정 보류(`RR_TAIL_HOLD_SAMPLES`).
  3. 포물선 보간(`parabolicOffset` / `parabolic_offset`).
  4. (선택) 지터 품질 플래그: 저장 컬럼 없이 넣을 경로가 없어 **생략**.
- 기록용 메타 `ALGORITHM_VERSIONS.ppg` '2'→'3'(+`PPG_ALGORITHM_HISTORY['3']`): 원시 아티팩트 스냅샷 메타일 뿐, 수치 버전 저장 아님.

## 2. 하네스 전/후 (원시 PPG 53명 중 지표 산출 가능 49~50명, 서비스 코드 그대로 재생, 사람별 중앙값 → 전체 중앙값)
| 지표 | 수정 전 | 수정 후(1초 간격) | 수정 후(0.5초 간격) | 원시 재계산(참고) |
|---|---|---|---|---|
| RMSSD(ms) | 117.2 | **32.3** | 32.8 | 36.7 |
| SDNN(ms) | 77.5 | 35.8 | 36.3 | 51.9 |
| pNN50(%) | 63.6 | 11.9 | 11.9 | 12.9 |
| HR(회/분) | 66.0 | 66.0 | 66.0 | 64.4 (|차| 중앙 0.95 전·후 동일) |
| LF/HF | 0.99 | 2.50 | 2.56 | 1.11 |
| 재계산과 ρ(RMSSD) | 0.47 | **0.93** | 0.93 | – |
| 비(서비스/재계산) 중앙 | 3.12 | 0.96 | 0.95 | – |
| RMSSD ≤ SDNN 인원 비율 | 0% | 67% (SDNN/RMSSD 중앙 1.14) | 66% | – |
- 회차별 분리 검증(과적합 확인) RMSSD 중앙 / 재계산 / ρ: b1 40.6/42.8/0.95, b2 28.4/29.4/0.90, m 40.0/42.7/0.97 — 세 묶음 모두 합격선(ρ≥0.9).
- 합격 판정: RMSSD 중앙 30~45 ✔, ρ≥0.9 ✔, HR 차 ≤1.5 ✔, 비 0.9~1.15 ✔, SDNN 30~55 ✔(35.8). "SDNN/RMSSD 중앙 ≤1.2" ✔(1.14).
- **LF/HF(이번에 처음 검증)**: 수정 전 0.99는 재계산 1.11에 우연히 가깝지만 ρ=0.30(사람별 무관). 수정 후 ρ=0.64로 개선되나 **중앙값 2.50 vs 재계산 1.11(비 1.7배)로 여전히 높음**. LF/HF 절대값은 이번 수정으로 신뢰할 수 없고(주파수 추정 방식이 원시 재계산과 다름: 서비스는 60 RR·≈1분 창), 추이 용도로만 쓸 것. **이번 범위에서는 수정하지 않음 → 결정 필요 항목.** 재산출 도구는 `lf_power/hf_power/lf_hf_ratio`도 같은 엔진 값으로 덮어쓴다(수정 후 서비스 값과 일치시키는 목적).

## 3. 테스트 (모두 로컬)
| 명령 | 결과 |
|---|---|
| `cd frontend && npx vitest run tests/fix-hrv-sdnn-scale.test.ts tests/sdd244 tests/sdd246-web tests/sdd273 tests/fix-ppg tests/fix-rmssd-zero-phase.test.ts` | 통과(위 묶음 29 파일 / 237 테스트, 1 skip) |
| `cd packages/measurement-core && cargo test --offline` | 전부 ok (golden_oracle 10, golden_acc_gf04 4, sdd314_hrv_gates, sdd316_not_worn, engine_invariants 포함) |
| 골든 oracle(biquad·legacy_fallback, `ORACLE_WRITE=1` 재생성) + `build_manifest.py build/check` | 33 / 32+1skip, manifest OK(177 파일) |
| `backend: pytest tests/test_fix_hrv_recompute.py tests/test_sdd036_hrv_motion.py tests/test_sdd027_rollup_raw_report.py` | 36 passed |
- 전체 vitest: 수정 전부터 실패하던 16개 파일(UI/네이티브 문자열 등)은 기준 커밋(032c5390) 단독 실행에서도 동일하게 실패(46건) — 이번 수정과 무관. 새 실패는 `fix-hrv-sdnn-scale`(첫 HRV 산출이 창 끝 1초 보류로 늦어짐) 1건뿐이라 합성 길이 110→125초로 조정했고, 조정 후 SDNN 43.7(참값 42.8)로 통과.
- 합성 신호 `fix-rmssd-zero-phase.test.ts`: 목표 RMSSD 15/40/80ms 편향 ±5ms(또는 ±12%)·HR ±1.5, 호흡성 변조 신호의 RMSSD·SDNN 참값 일치, 0.5초 간격. (수정 전 코드는 15ms 구간에서 +6.4ms로 실패 — 합성은 보조 근거, 실데이터 하네스가 주 근거.) 계획의 "호흡성 변조에서 RMSSD/SDNN ≤ 1"은 **수학적으로 성립하지 않아**(빠른 호흡은 RMSSD>SDNN이 정상) 참값 일치 검사로 바꿈.

## 4. 재산출 도구 (운영 실행 안 함)
- 파일: `backend/scripts/recompute_ppg_hrv.py`(CLI), `backend/app/services/hrv_recompute_service.py`(로직), `packages/measurement-core/examples/recompute_ppg_hrv.rs`(엔진), `backend/tests/test_fix_hrv_recompute.py`(6건).
- **엔진 선택 이유**: Rust 코어 example. 네이티브 앱과 같은 코어이고, 웹 TS와 같은 입력에서 소수 6자리까지 같은 값(RMSSD 27.984/ SDNN 34.09 일치 확인; 골든·WASM 패리티 테스트가 고정). 서버에서 Node/브라우저 번들 없이 단일 바이너리 실행. 서버 사전 준비: `cd packages/measurement-core && cargo build --release --example recompute_ppg_hrv` (또는 `HRV_RECOMPUTE_BIN`).
- 동작: S3 `biosignal-raw/…/ppg/`(v2, uploaded) → 디코드(연속 구간별) → 서비스와 동일 재생(500샘플·1초 간격) → `eeg_feature_windows.device_timestamp_ms`와 가장 가까운 틱(±750ms)의 `rmssd/sdnn/lf_power/hf_power/lf_hf_ratio`로 **UPDATE**. `heart_rate`·EEG 컬럼 불변. 롤업 `*_mean`은 윈도우에서 온디맨드 파생이라 저장분이 없다 → 윈도우만 고치면 반영됨.
- 사용법:
  ```
  cd backend
  python scripts/recompute_ppg_hrv.py --session-id <UUID> [--since 2026-10-01] [--limit 20]            # 기본 dry-run
  python scripts/recompute_ppg_hrv.py --apply --backup-dir /var/lib/mindbreeze/hrv-backup [--confirm-production]
  python scripts/recompute_ppg_hrv.py --rollback <백업.jsonl> [--confirm-production]
  ```
- 안전장치: 기본 dry-run(DB 변경 0) · apply는 회차 단위 트랜잭션(+백업 JSONL fsync 후 UPDATE) · rollback은 백업의 원래 값 복원 · 멱등(2회차 변경 0) · 원시 없음/디코드 실패 참가자 미변경(건수만) · 새 값이 null이면 기존 값 유지(0·null 치환 금지) · `ENVIRONMENT=production`이면 `--apply/--rollback`에 `--confirm-production` 필요.
- 로컬 dry-run 예시(합성 1회차: 참가자 2명 중 1명 원시 없음, 저장값 117/79 가정):
  `participants 2 · participants_no_raw 1 · windows_considered 156 · windows_unmatched 78 · windows_changed 78 · cells_changed 390 · medians rmssd 117.0→31.5, sdnn 79.0→22.1`
- 한계: 윈도우 매칭은 시각 근접(±750ms) 기반(윈도우 시각은 sample 단위가 아닌 ms). 서버에서 실제 데이터 dry-run으로 `windows_unmatched` 비율을 먼저 확인할 것. 원시 v2가 없는 과거 회차(v1/미업로드)는 재산출 불가 → `sessions_without_raw_untouched`로 규모 보고.

## 5. 리포트 영향
### 5-1. 문구 임계 점검 (변경 없음)
- `report_narrative.py:8`, `report_pdf_narrative.py:149,160`, `resolve-narrative.ts:168`, `ui-v2-report-v3-logic.ts:54`: "HRV" 변화량 = 전·후반 SDNN 차이, ±5ms 이상이면 up/down.
- 하네스 53명의 전반/후반 SDNN 차이 분포: 수정 전 |차| 중앙 7.3(75퍼센타일 10.9, 5ms 초과 60%), 수정 후 4.6(8.3, 47%). SDNN 수준 자체가 77→36으로 줄었는데 임계 5ms는 상대 변화로는 6.4%→13.8%로 **더 엄격**해졌다. 임계를 낮추면 "안정" 구간이 줄어 소음이 변화로 읽히므로(안정 명상 상태에서도 절반 가까이 5ms 초과) **5ms 유지**가 합리적. 문구 템플릿("자율신경 회복이 좋았어요" 등)은 절대값을 말하지 않아 영향 없음. 명상=점수 금지 원칙 유지(서사·변화량만).
- 결정 필요(아래): 임계를 상대값(예 ±10%)으로 바꿀지는 별도 SDD 사안.

### 5-2. 이미 생성된 리포트의 재생성 필요 판정 방법 (재생성은 안 함)
- 리포트 JSON(`reports.content`, JSONB)에 박혀 있는 값: `timeline[].sdnn/rmssd/lf_power/hf_power/lf_hf_ratio`(`report_task.py:340`), 요약 `sdnn_mean/rmssd_mean/…`(`summarize_hrv_motion`), 서사 `hrv` 항목(전·후반 SDNN 기반 방향·변화량 문장). 생성된 PDF는 `reports.pdf_url`(S3)에 있고 같은 값을 포함한다.
- **재생성 필요 = 재산출로 윈도우가 실제 바뀐 회차의 리포트.** 판정:
  1. `--apply` 백업 JSONL의 `session_id` 집합 S (바뀐 회차).
  2. `SELECT id, session_id, type, status, pdf_url FROM reports WHERE session_id IN S AND (content::text LIKE '%"sdnn"%' OR content::text LIKE '%"rmssd"%' OR content ? 'sdnn_mean')` → 재생성 후보. (`status` 가 발송 완료면 외부로 나간 리포트라 정정 안내 여부는 별도 결정.)
  3. 원시 없음으로 미변경인 회차의 리포트는 과거 수치 그대로이므로 **재생성 대상 아님**(수치는 여전히 과대 — 표기만 숨기는 B안 필요 시 별도).
  - 재생성은 `report_task.generate_reports_for_session(session_id)` / `report_service.generate_report` 경로. 상담사 코멘트·class_report 는 기존 내용을 보존하는 분기(`report_task.py:637~690`)가 있으나, **재생성 전 반드시 건별 승인**.
- 서사 캐시(`narrative_cache`)는 방향 시그니처(↓↑→)별 문장 캐시라 수치가 없어 무효화 불필요.
- 외부 배포 그룹 분석 PDF(`~/.hermes/share/daegu-group-1112/` 4종)는 서비스 DB가 아닌 별도 산출물이라 이 도구 대상이 아님(plan.md §5).

## 6. 앱·WASM 재빌드
- **WASM: 재생성 완료·커밋**(`frontend/src/lib/measurement-web/wasm/measurement_core_bg.wasm`, js/d.ts 불변 확인). 웹은 이 파일을 쓰므로 프런트 배포만으로 반영.
- **네이티브 앱: 재빌드 필요(이번에 빌드 안 함).** Android `.so`(`scripts/build-all.sh` aarch64-linux-android)·iOS xcframework(`frontend/ios/MeasurementKit/scripts/build-core-xcframework.sh`)는 Rust 코어를 포함하므로 새 앱 빌드 전까지 앱 사용자의 측정은 옛 값을 낸다. 웹 TS 경로(PPGSignalProcessor)는 다음 프런트 배포로 즉시 반영.
- 골든 픽스처 갱신: `expected/oracle|legacy_fallback|gf04`, `manifest.json`, `frontend/tests/fixtures/sdd273/native-*.json`(수정 전 출력이 기존 픽스처와 바이트 일치함을 확인한 뒤 재생성).

## 7. 결정 필요 / 알려진 한계
1. LF/HF: 수정 후에도 중앙 2.5(재계산 1.1). 절대값 신뢰 불가 — LF/HF 산출 방식 별도 점검 SDD를 열지, 리포트에서 LF/HF 절대값 노출을 줄일지.
2. 문구 임계 ±5ms 유지(변경 안 함) — 상대값 방식 전환 여부.
3. 운영 재산출 실행 시점·범위(감독이 배포 후 OPS 창구로): 순서 권장 = 서버에 엔진 빌드 → `--limit 3` dry-run → `windows_unmatched` 비율 확인 → 회차 소수 apply → 리포트 재생성 후보 목록.
4. 네이티브 앱 재빌드 시점.
5. 합성 신호 시험의 15ms 구간은 수정 전후 차이가 작다(+6.4ms) — 낮은 RMSSD(<15ms) 사용자의 하한은 포물선 보간으로 개선되나 PPG 자체 한계가 있음.
