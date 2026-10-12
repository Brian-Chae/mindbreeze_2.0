# [SDD-122] 리포트 데이터 유실 표시 기반

## Goal
밴드 연결 끊김/EEG·생체 데이터 유실 시 리포트가 유실을 **식별(미측정 vs 유실 구분)** 하고 **표시(사유·커버리지·신뢰도 하향)** 하도록 백엔드(유실 메타) + 프론트(표시 UI)를 구현한다.

## Context
- **확정 결정(2026-10-04)**: A1(내담자에 유실 명시 + 이유 상세, 기술 용어·수치 비노출) / B2(50% 미만 → "참고용" + "신뢰도 매우 낮음" 확실 고지) / C2(복구=백엔드/시스템 오류 처리만, 밴드 재연결은 복구 아님 — 밴드에 저장소 없음).
- **기획**: `docs/MIND_BREEZE_2.0_리포트_데이터유실_정책_기획.md` (§4). **디자인**: `designs/report-loss-policy/` (mockup.html + DESIGN.md).
- **현재 빈틈(G1)**: `_build_eeg_content`가 윈도우 0개면 무조건 `status="not_measured"` → 밴드 미착용(정상)과 밴드 착용 후 전 구간 유실(비정상)을 구분 못 함. 자산 손실이 "정상 미측정"으로 위장됨.
- **현재 신뢰도(G2)**: `_derive_data_credibility` — `valid→high / degraded→medium / invalid·insufficient→low / not_measured→None`. 하향 사유(끊김 vs 저품질) 미표기.

## Scope

### ✅ In-scope (백엔드)
1. `_build_eeg_content`가 **유실 메타 필드**를 산출: `loss_reason`(band_disconnect/ws_drop/backend_error/low_quality/null), `coverage_ratio`(0~1, 유효 측정 비율).
2. **`lost` vs `not_measured` 구분**: `measurement_intent="no"` + 윈도우 0 → `not_measured`(숨김 유지). `intent="yes"` + 윈도우 0 → `status="lost"`(표시).
3. **`measurement_intent` 파생(내부 전용)**: `SessionParticipant.band_connected`(실연결 여부, 이미 영속) OR EEGFeatureWindow 존재 → "yes", 아니면 "no". 출력 계약에는 노출하지 않고 status(lost/not_measured)로만 구분한다.
4. **`coverage_ratio` 산출**: usable(valid/degraded) 윈도우 수 / 세션 유효 시간(started_at~ended_at, 초). 세션 경계 없으면 None(과잉 하향 판정 방지).
5. **신뢰도 확장**: `data_credibility`에 `very_low` 추가 — `lost`이거나 `coverage_ratio < 0.5`면 "very_low". 사유는 content.eeg.loss_reason으로 제공.

### ✅ In-scope (프론트)
6. 공통 EEG 계약(`report.ts` — `parseEegBlock`/`adaptReportContent`) + 공통 배너 컴포넌트(`EegQualityBanner`)에 반영:
   - **`lost` 상태**: 유실 배너 + 사유 칩("연결 끊김") + 커버리지 수치(counselor). counselor=관리 문구, client=차분 문구(A1).
   - **`coverage_ratio < 0.5`**: "참고용 + 신뢰도 매우 낮음" 고지(B2).
   - **`data_credibility="very_low"`**: 신뢰도 라벨("신뢰도 매우 낮음").

### ❌ Out-of-scope (후속 SDD)
- 50% 미만 시 EEG 서사 "보류/차단" 로직(B2는 표시만, 서사 생성 로직 변경 없음).
- 24h 복구 창(provisional 상태머신 + 복구 워치독 beat).
- 유실 개입 시 auto-approve 우회(리뷰 강제).
- 유실 가시성 대시보드/집계.

## Acceptance Criteria
- [x] `_build_eeg_content`가 `loss_reason`/`coverage_ratio`/`status`("not_measured"/"lost"/품질) 산출.
- [x] `_derive_data_credibility`가 lost·coverage<0.5 → `very_low` 반환, not_measured → None 유지(하위호환).
- [x] 프론트가 `lost` 상태에서 유실 배너 + 사유 칩 + 커버리지 표시, `not_measured`는 종전대로 숨김.
- [x] client 뷰(A1): 유실 명시 + 차분한 문구, 기술 용어(사유 코드·수치) 비노출.
- [x] B2: coverage<0.5면 "참고용" + "신뢰도 매우 낮음" 고지.
- [x] 기존 `not_measured`(미착용) 동작 무회귀 — 섹션 숨김 유지.
- [x] `pytest`(1002 passed) + `npm run build` 0 errors.

## Dependencies
- SDD-120(밴드 재연결), SDD-117(raw 로컬 저장), SDD-027(신뢰도), SDD-085(ai_record), SDD-114(타임라인).

## Risks
- `band_connected`가 실제로 세션 중 True로 갱신되지 않는 경로가 있으면 lost 오판 가능 → lost 판정은 "윈도우 0 + band_connected=True"로 보수적(거짓 lost보다 거짓 not_measured가 안전).
- data_credibility "very_low" 신규 값이 기존 소비처(목록·필터) 회귀 → grep으로 전 소비처 확인.
- 프론트 어댑터가 다중 화면(ReportView/ReportDetail/ClientReportDetail)에 분산 → 공통 `report.ts` adapt 계약 + `EegQualityBanner`로 통합.
