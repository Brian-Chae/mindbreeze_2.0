# SDD-023 — Verify (구현 전 QA 게이트)

## 1. BLE 연결
- [ ] Web Bluetooth로 LXB 접두사 디바이스 스캔 → 연결
- [ ] 미지원 브라우저(Safari/Firefox) 감지 → 안내 메시지
- [ ] 연결 해제 시 호스트/게스트 UI 상태 반영

## 2. raw → feature 파이프라인
- [ ] EEG 250Hz 패킷 파싱 (ch1/fp1, ch2/fp2, leadoff)
- [ ] 밴드파워(delta/theta/alpha/beta/gamma) 산출
- [ ] 1초 지표(focus/relaxation/stress/meditation) 산출
- [ ] mockDataGenerator로 위 과정 재현

## 3. ingestion API
- [ ] POST /sessions/{id}/features 5초 배치 → EEGFeatureWindow 저장
- [ ] participant 검증(미참가자 403)
- [ ] live-metrics가 최신 윈도우 실값 반환

## 4. UI 실데이터
- [ ] 호스트 SessionMonitorTable: 두뇌휴식도·연결상태·배터리 실값
- [ ] 게스트 GuestMeditationPanel: 뇌파 차트·두뇌휴식도 실값
- [ ] 미착용/미연결 시 placeholder(대기) 표시

## 5. 회귀
- [ ] 백엔드 pytest 전체 통과
- [ ] 프론트 tsc 0 error + build 통과
- [ ] biquadjs 번들 정상(빌드 실패 없음)
