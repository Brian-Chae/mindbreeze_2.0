# 호흡·HRV 미표시 — Summary

## 원인 조사 결과
- (a) 계산: `AnalysisMetricsService` 게이트는 RR 30박 → SDNN(RR 합 30초·10박 이상, `calculateTimeDomainMetrics`), 호흡(실제 경과 60초 이상, `calculateRespiratoryRate:482`). 합성 PPG(50Hz, RSA 0.25Hz, 드리프트·잡음)를 `parsePPGPacket`(타임스탬프 정규화 포함)→`StreamProcessor`로 흘린 재현에서 약 60초에 SDNN, 약 90초에 호흡이 산출됨(`tests/fix-resp-hrv-repro.test.ts`·`fix-resp-hrv-ble.test.ts`). 계산 코어·입력 샘플레이트(50Hz)·버퍼(10초 창)·피크 검출은 정상 동작. 드리프트가 극단적으로 큰 신호(기저선 변동이 맥박 진폭의 20배 이상)에서는 피크가 거의 안 잡혀 영구 null 이 되는 한계가 있으나, 실기기 신호로 확인하지 못해 알고리즘은 건드리지 않음.
- (a') 전달: `useBand.ts:835-836`(ingestMetrics 1Hz에서 `body.getCurrentRespiratoryRate/SDNN` 읽음) → `MemberClassContainer.buildSnapshot:73-74` → 서버 `metricsToFeature:326,332`(sdnn·respiratory_rate) → `live-metrics`. 경로 단절 없음.
- (b) 회원 메인: 기본 hero=이완도(`MemberClassContainer:120`). 호흡·HRV는 `MemberSheets` 링 또는 hero 전환 시에만 보이며, 값이 null 이면 hero 링은 '측정하는 중이에요'(`MemberStage.tsx:74`), 시트 링은 '측정 중'(`MemberSheets.tsx:97`).
- (c) 상담사: 
  - 1:1 큰 카드 `HostMinis`(`HostPersonParts.tsx:26`)는 값 없으면 '—'만 표시(PR#108 '측정 중' 미적용 지점).
  - 레거시 모니터 카드/표/상세(`SessionParticipantCardGrid`·`SessionMonitorTable`·`SessionParticipantDetailPanel`)에는 **HRV 항목 자체가 없고**, 호흡수는 값 없으면 '-'.
  - 그룹 그리드는 10초 순환(`useHostUi.ts:6`)이라 호흡·HRV가 잠깐씩만 보임.
- 실기기 확인: adb 기기(R3CMA0C3Y4T) 가 `adb devices` 목록에 안 나와 logcat 확인 불가 → 실기기 값(PPG 신호 품질)에서의 산출 여부는 미확정.

## 수정
- `lib/session-live/metric-display.ts`: `formatBodyMetric` 추가(접촉 OK 인데 값 없음 → '측정 중', 값 → 반올림 숫자, 접촉불량·끊김 → '-').
- `HostPersonParts.tsx`: 착용 중 호흡·HRV 값 없으면 '측정 중'(미착용 '—' 유지).
- `SessionParticipantCardGrid.tsx`·`SessionMonitorTable.tsx`·`SessionParticipantDetailPanel.tsx`: HRV(SDNN) 타일/열 추가, 호흡수·HRV 항상 노출. 점수·판정 없음.
- PPG 계산 알고리즘·서버·미착용 경로 변경 없음.

## 테스트
- 신규 `tests/fix-resp-hrv-display.test.tsx` 6건: 수정 전 RED 3 / 수정 후 GREEN 6.
- 신규 재현 `fix-resp-hrv-repro`·`fix-resp-hrv-ble`(계산 경로 회귀) 4건 통과.
- 전체 vitest: 3115건 중 17 실패(기준선과 동일, 8파일), 3098 통과. tsc 0 오류, eslint 0, build 성공. 백엔드 변경 없어 pytest 해당 없음.

## 실기기 확인 절차 (미수행)
1. dev 배포 후 LINK BAND 착용 회원 입장, 상담사 웹 동시 접속.
2. 입장 직후~60초: 상담사 1:1 카드·모니터 카드/표에 호흡·HRV '측정 중' 노출 확인.
3. 약 60~90초 후 숫자 전환 확인. 90초가 지나도 '측정 중'이면 회원 기기에서 `adb logcat | grep -i chromium` 로 `[DIAG:handleBT] type=ppg` 수신과 RR 버퍼 상태 확인(PPG 신호 품질·접촉 의심).
