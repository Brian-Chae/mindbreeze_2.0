# [SDD-122] — Implementation Plan

**Goal:** 리포트 유실 식별·표시 기반 (백엔드 유실 메타 + 프론트 표시 UI).

**Architecture:**
```
EEGFeatureWindow + SessionParticipant.band_connected
        │  (report_task._measurement_intent — 내부 판정)
        │  (report_task._build_eeg_content)
        ▼
content.eeg = { status: not_measured|lost|valid|degraded|invalid|insufficient,
                loss_reason: band_disconnect|ws_drop|backend_error|low_quality|null,
                coverage_ratio: 0~1|null,
                ...기존(reliability/metrics/timeline/narrative) }
        │  (report_task._derive_data_credibility)
        ▼
Report.data_credibility = high|medium|low|very_low|null
        │  (frontend report.ts — parseEegBlock + adaptReportContent)
        ▼
EegQualityBanner — 유실 배너 / 사유 칩 / 커버리지 / 참고용+매우낮음 (counselor·client 차등)
```

**Tech Stack:** FastAPI + SQLAlchemy(기존), React + TS + Tailwind(기존).

## Files Changed
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/tasks/report_task.py` | `_measurement_intent`·`_coverage_ratio`·`_loss_reason` 헬퍼 + `_build_eeg_content`(lost/coverage/loss_reason) + `_derive_data_credibility`(very_low) |
| Modify | `backend/app/models/record.py` | `data_credibility` 주석 갱신(very_low 추가, 컬럼 변경 없음) |
| Modify | `frontend/src/lib/api/report.ts` | `EegQualityStatus`에 `lost` + `ReportEegContent`에 `loss_reason`/`coverage_ratio` + 파서 반영 |
| Modify | `frontend/src/lib/api/report-status.ts` | `credibilityFromQuality`(lost→very_low) + 신뢰도 문자열 라벨 맵 |
| Modify | `frontend/src/components/reports/EegQualityBanner.tsx` | lost 배너 + 사유 칩 + 커버리지 + "매우 낮음" 고지 |
| Modify | `frontend/src/components/reports/ReportDetailView.tsx` | `eegQualitySummaryLabel`에 lost |
| Create | `backend/tests/test_report_loss_policy.py` | 유실 메타·very_low 단위 테스트 |

## Tasks
1. **백엔드 헬퍼 + `_build_eeg_content`** — `_measurement_intent`(band_connected 기반), `_coverage_ratio`, `_loss_reason`, `status="lost"`. ✅
2. **백엔드 `_derive_data_credibility` very_low** — lost·coverage<0.5 → very_low, not_measured → None. ✅
3. **백엔드 단위 테스트** — `test_report_loss_policy.py`. ✅
4. **프론트 계약** — `report.ts`(타입+파서), `report-status.ts`(신뢰도). ✅
5. **프론트 표시 UI** — `EegQualityBanner`(배너/칩/커버리지/고지) + `ReportDetailView` 라벨. ✅
6. **검증** — pytest + npm build + Tailwind 클래스 생성. ✅

## Testing Strategy
- `cd backend && venv/bin/python -m pytest tests/test_report_loss_policy.py -q`
- `cd backend && venv/bin/python -m pytest -q` (전체 회귀)
- `cd frontend && npx tsc --noEmit -p tsconfig.json` + `npm run build`

## 참고
- `measurement_intent`는 출력 계약에서 제외(내부 판정 전용) — `not_measured` 정확 계약(`{"status": "not_measured"}`)을 보존해 기존 통합테스트 3건·계약테스트 1건 무회귀.
- 의도 신호는 `consent_eeg`가 아닌 `SessionParticipant.band_connected`(실연결 영속) 사용 — 더 정확.
- `EegQualityBanner`는 counselor·client 양쪽(ReportDetailView·ClientReportViewer)이 공유 — 단일 수정으로 A1 차등 적용.
