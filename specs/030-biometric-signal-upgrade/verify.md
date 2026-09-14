# SDD-030 Verify — 구현 전 QA 체크리스트

> Stage ③ — 구현 전 작성. 아래 시나리오가 구현 후 실제로 통과해야 한다.

## 1. 호흡수 산출 (Phase 1)

- [ ] PPG RR interval이 충분히 쌓이면 `respiratoryRate`가 6~40 bpm 범위로 산출된다
- [ ] RR 버퍼 부족 시 `respiratoryRate`가 `null` (0 치환 금지)
- [ ] 호흡을 빠르게/느리게 할 때 호흡수가 그에 따라 변한다 (정성 확인)
- [ ] BPM/HRV와 독립적으로 계산된다 (회귀 없음)

## 2. 몸 지표 실시간 전달 (Phase 2)

- [ ] 1초 feature에 `heart_rate`·`respiratory_rate`·`sdnn`·`rmssd`·`lf_power`·`hf_power`·`lf_hf_ratio`가 포함된다
- [ ] 백엔드 `EEGFeatureWindow`에 `respiratory_rate`가 저장된다 (DB 확인)
- [ ] WS `/session-live` `eeg_feature` payload에 몸 지표가 포함된다
- [ ] 사용자(GuestMeditationPanel) 화면에 BPM·호흡수·HRV가 표시된다
- [ ] 상담사(SessionLivePage) 테이블에 BPM·호흡수가 표시된다 (3초 평균)

## 3. 리포트 상세화 (Phase 3)

- [ ] 리포트에 BPM 평균/최소/최대, 호흡수 평균, HRV 평균이 포함된다
- [ ] 호흡수 미측정(null) 시 리포트가 깨지지 않는다

## 4. 회귀 검증

- [ ] 프론트 `npm run build` 0 error
- [ ] 백엔드 `pytest` 전체 통과 (기존 328 + 신규)
- [ ] 기존 마음 지표(집중/이완/스트레스) 정상 동작 (0~100%)
- [ ] LINK BAND 연결·EEG 실시간 흐름 회귀 없음

## 5. 수동 E2E (Chrome + LINK BAND)

- [ ] 연결 → 착용 → 클래스 시작 → 명상 화면에서 두뇌휴식도·몸 지표 변동
- [ ] 상담사 화면에서 참가자 BPM·호흡수·두뇌휴식도가 차분히(평균) 갱신
