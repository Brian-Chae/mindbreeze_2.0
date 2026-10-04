# [SDD-122] — Summary

## 구현 결과
리포트 데이터 유실 표시 기반(Phase 3)을 백엔드 + 프론트 양쪽에 구현했다. A1/B2/C2 확정 결정을 코드로 반영.

### 백엔드 (`backend/app/tasks/report_task.py`)
- **`_measurement_intent`**: `SessionParticipant.band_connected`(실연결 영속) OR EEGFeatureWindow 존재 → "yes"/"no". 내부 판정 전용(출력 제외).
- **`_build_eeg_content`**:
  - 윈도우 0 + intent="no" → `{"status": "not_measured"}` (미착용, 숨김 유지 — 정확 계약 보존).
  - 윈도우 0 + intent="yes" → `{"status": "lost", "loss_reason": "band_disconnect", "coverage_ratio": 0.0}` (유실 표시).
  - 윈도우 존재 → `loss_reason`(low_quality/null) + `coverage_ratio`(usable/세션초) 추가.
- **`_coverage_ratio`**: 유효(valid/degraded) 윈도우 수 / 세션 유효 시간(started_at~ended_at). 경계 없으면 None(과잉 하향 판정 방지).
- **`_loss_reason`**: valid 없이 저품질뿐이면 "low_quality", 정상이면 null.
- **`_derive_data_credibility`**: `lost` 또는 `coverage_ratio < 0.5` → `"very_low"`. `not_measured` → None 유지(하위호환).

### 백엔드 (`backend/app/models/record.py`)
- `data_credibility` 주석에 very_low 추가(컬럼 변경 없음, String(20)).

### 프론트
- **`report.ts`**: `EegQualityStatus`에 `lost` 추가, `ReportEegContent`에 `loss_reason`/`coverage_ratio` 추가, `parseEegBlock`/`parseLegacyEeg` 반영, `coverReasonForStatus`에 "데이터 유실".
- **`report-status.ts`**: `credibilityFromQuality`(lost→very_low) + 신뢰도 문자열 라벨 맵(high/medium/low/very_low/insufficient).
- **`EegQualityBanner.tsx`**: lost 배너(counselor/client 차등 문구) + 사유 칩(연결 끊김 등) + 커버리지 수치 + "데이터 유실로 신뢰도 매우 낮음" 고지(B2).
- **`ReportDetailView.tsx`**: `eegQualitySummaryLabel`에 "데이터 유실".

## 테스트
- **백엔드**: `pytest -q` → **1002 passed, 12 skipped** (전체, 회귀 없음). 신규 `tests/test_report_loss_policy.py`(14개 단위 테스트) 포함.
- **프론트**: `tsc --noEmit` 0 errors, `npm run build` 성공, Tailwind 클래스(bg-rose-50/border-rose-200/text-rose-800 등) dist CSS 생성 확인.

## 디버깅 (과정)
- **`not_measured` 계약 회귀**: 처음 `measurement_intent`를 출력 계약에 넣자 통합테스트 3건(`test_report_email`×2, `test_sdd086`) + 계약테스트 1건(`test_report_eeg_additive_contract`)이 깨짐(정확 비교 `== {"status": "not_measured"}`). → `measurement_intent`는 출력에서 제외(내부 판정 전용), `not_measured` 정확 계약 보존으로 해결.
- **Mock 쿼리 체인**: `_measurement_intent`가 `.filter()` 2회 호출 → 테스트 Mock(`.filter().first()=None`)과 불일치로 lost 오판. → `filter(*conditions)` 단일 호출로 단순화(프로덕션·테스트 모두 정상).

## 결정 정리
- 의도 신호는 `consent_eeg`(동의 프록시)가 아닌 `band_connected`(실연결 영속) 사용 — 더 정확.
- `measurement_intent`는 출력 계약에서 제외 — `status`(lost/not_measured)로 구분. 단순화 + 기존 계약 보존.
- 표시 위치는 `EegQualityBanner`(공통 배너) 단일 — counselor/client 양쪽이 공유하므로 A1 차등도 한 곳에서 적용.

## 미완 (후속 SDD)
- 50% 미만 시 EEG 서사 "보류/차단"(B2는 표시만).
- 24h 복구 창(provisional + 워치독).
- 유실 개입 시 auto-approve 우회.
- 유실 가시성 대시보드/집계.
