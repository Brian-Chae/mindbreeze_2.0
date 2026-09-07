# SDD-028 — P2: 반복 실행(run_id) + 규모 확장

> 코드 레벨 SDD. Linear 미편성. 멀티에이전트에 Codex 포함.
> 근거: specs/025-live-session-parity-analysis/ (P2 로드맵)

## 목표
SDD-027(P1)에 이어 P2를 구현한다: ① 명시적 반복 수업 실행을 구분하는 run_id(경량 SessionRun) ② 대규모 참여자에서도 안정적인 조회·집계를 위한 규모 확장 준비.

## 배경 (SDD-025 Codex P2 정의)
- 같은 수업 정의를 여러 번 실행할 때 템플릿·세션·실행 회차를 구분. 재접속·pause/resume은 기존 run_id, 명시적 새 실행만 새 run_id.
- 현행 completed 세션을 바로 재시작하도록 상태 규칙을 느슨하게 바꾸지 않음.
- 규모 확장은 부하 측정 후 진행: 차등 갱신·가상화, 파티션/보관, 운영 대시보드.

## 실용적 스코프 (Brian 단순화 선호 반영)

### 1. run_id (경량 SessionRun)
- `Session.run_id` 컬럼 추가(기본 = session_id). 같은 수업 정의를 "새 실행"으로 열 때 새 run_id 발급.
- 재접속·pause/resume·이어하기는 기존 run_id 유지(새 회차 아님).
- EEGFeatureWindow/EEGRawChunk/Report는 이미 session_id 기반이므로, run_id는 조회·집계의 그룹핑 키로만 활용(대규모 마이그레이션 회피).
- completed 세션의 즉시 재시작 허용 안 함(기존 상태 규칙 유지).

### 2. 규모 확장 준비 (쿼리·인덱스)
- EEGFeatureWindow/EEGRawChunk 조회를 전체 스캔 → batch key(window_index 범위) 조회로 최적화
- 최신값·집계 조회 제한(LIMIT + 인덱스), 복합 인덱스(session_id, participant_id, window_index) 확인·추가
- live-metrics·eeg-rollup에서 원천 전체 읽기 → 필요한 범위만 읽도록 개선

### 3. 차등 갱신 준비
- WS eeg_feature broadcast에서 전체 재계산 대신 증분 갱신(최신 feature만)이 가능한 계약 확인

## 수락 기준
- [ ] run_id 발급/유지 로직 (새 실행 = 새 run_id, 이어하기 = 기존 run_id)
- [ ] EEGFeatureWindow/EEGRawChunk 조회가 batch key 기반(전체 스캔 제거)
- [ ] 복합 인덱스 적용, 마이그레이션 포함
- [ ] completed 세션 즉시 재시작 불가(기존 유지)
- [ ] 백엔드 pytest 통과 + 프론트 tsc/build 통과
