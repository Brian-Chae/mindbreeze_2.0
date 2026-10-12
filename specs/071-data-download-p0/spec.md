# SDD-071 — 분석용 데이터 다운로드 P0 (개별 feature CSV + 리포트 JSON)

> 기획안 `docs/data-download-기획.md`의 P0 단계.
> 상담사·플랫폼 관리자가 참가자 1명의 분석 가능한 데이터(feature CSV + 리포트 JSON)를
> ZIP으로 다운로드한다. 비동기 생성 + S3 저장 + 프리사인드 URL 다운로드.

## 1. 범위
- **개별 참가자** 다운로드만 (그룹/클래스는 P1, raw Parquet는 P2, 음성은 P3)
- feature CSV(1초 원천 시계열) + 참가자 완료 리포트 JSON + 세션/참가자 메타 + manifest + 데이터 사전 + README

## 2. 데이터 소스 (이미 확인됨)
- `EEGFeatureWindow`(eeg_feature_windows): 1초 시계열 — 8개 7지표(focus_index, cognitive_load, relaxation_index, stress_index, emotional_stability, total_neural_activity, faa, hemispheric_balance) + 밴드파워(delta/theta/alpha/beta/gamma/total_power, meditation_level, attention_level, signal_quality) + HRV·움직임(sdnn, rmssd, lf_power, hf_power, lf_hf_ratio, heart_rate, respiratory_rate, motion) + window_index, quality, device_timestamp_ms, play_group_id
- `Report`(reports): content(JSONB), status, data_credibility, participant_id
- `Session`/`SessionParticipant`: 세션·참가자 메타

## 3. 구현 (codex gpt-6-astra)
### T1. 모델·마이그레이션
- `DataExportJob` — 요청자, 범위(session/participant), 옵션, 목적, 상태(queued/preparing/ready/ready_with_warnings/failed/expired/cancelled), 스키마버전, 기준시각, S3 객체 키, 크기, 체크섬, 만료·오류 코드

### T2. 서비스
- feature window → CSV(허용 필드, null 보존, UTF-8) 생성
- 리포트 → JSON(허용 필드) 생성
- manifest.json + session_metadata.json + data_dictionary.json + README_ko.md
- ZIP 생성 → S3 업로드
- 가명화: 실명/이메일/생년월일/성별 기본 제외, 가명 키 사용

### T3. API
- `POST /api/v1/sessions/{session_id}/participants/{participant_id}/data-exports` → 202 + export_id
- `GET /api/v1/data-exports/{export_id}` → 상태·진행
- `POST /api/v1/data-exports/{export_id}/download-url` → S3 presigned GET URL
- 권한: 상담사=Session.host_id==current_user, 플랫폼=전체. 기관 관리자는 기관 귀속 정책 미확정 → 이번 P0에서 제외(명시)
- Idempotency-Key 지원

### T4. Celery 비동기 + S3
- export 전용 태스크, RDS 배치 조회 → CSV/ZIP → S3 업로드 → ready
- storage_service에 GET presigned(다운로드용) 추가

### T5. FE
- 리포트 상세/세션 상세 참가자 행에 "데이터 다운로드" 버튼
- 요청 → 상태 폴링 → 완료 시 다운로드(프리사인드 URL)

## 4. 주의
- 뇌파=민감정보: 가명화 기본, 감사 기록, 보관 24h/URL 5분
- CSV null 보존, 부동소수점 반올림·보간 금지
- quality/결측 원천 의미 유지
- S3 GET 서명은 스텁 성공 금지(명시 실패)

## 5. 완료 기준
- 참가자 1명 feature CSV + report JSON ZIP 다운로드
- 권한 검사 + 감사 + 만료 처리
- BE pytest 통과, FE build 0 error
