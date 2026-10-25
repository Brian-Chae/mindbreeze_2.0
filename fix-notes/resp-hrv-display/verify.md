# 호흡·HRV 미표시 — Verify (구현 전)

## 확인된 사실 (코드 추적)
- 계산: `AnalysisMetricsService` RR≥30박 → SDNN(RR 합 30초↑·10박↑), 호흡(실제 경과 60초↑). 합성 PPG(50Hz·RSA·드리프트·잡음)를 BLE 패킷 파서→`StreamProcessor`로 흘린 재현에서 약 60초에 SDNN, 약 90초에 호흡 산출(`tests/fix-resp-hrv-repro.test.ts`, `fix-resp-hrv-ble.test.ts`). 계산 코어 자체는 정상.
- 회원 메인: `MemberClassContainer.buildSnapshot`(band.respiratoryRate/sdnn) → `MemberStage.HeroRing`(hero) / `MemberSheets`(6지표 링). 기본 hero=이완도라 호흡·HRV는 시트/링을 눌러야 보인다.
- 상담사: `HostLiveContainer`→`HostLiveView`. 1:1 카드 `HostMinis`(HostPersonParts.tsx)는 값 없으면 '—'(측정 중 문구 없음). 그룹 그리드는 10초 순환으로 한 지표만 표시.
- 레거시 모니터(`SessionParticipantCardGrid`/`SessionMonitorTable`/`SessionParticipantDetailPanel`): HRV 항목 없음, 호흡수는 값 없으면 '-'.
- adb 기기(R3CMA0C3Y4T) 미연결로 실기기 logcat 확인 불가 → 실기기 원인은 미확정, 확인 절차는 summary에 기재.

## 수정 범위
1. 값 없는 호흡·HRV는 모든 상담사 표면에서 '측정 중'(점수·판정 금지, 밴드 미착용·끊김은 기존 '—' 유지).
2. 상담사 레거시 모니터 카드/표/상세에 HRV(SDNN) 항상 노출.
3. 회원 메인 링: hero가 호흡·HRV이고 값 없으면 '측정 중' 문구.

## 시나리오
- V1 HostMinis: band=on, respiration/hrv null → '측정 중', 값 있으면 숫자, band=off → '—'.
- V2 SessionParticipantCardGrid: 접촉 OK 행에 HRV 타일 존재, null → '측정 중', 값 → 숫자.
- V3 SessionMonitorTable: HRV 열 존재, null → '측정 중'.
- V4 접촉 불량/끊김 행은 호흡·HRV '-' 유지(측정 중 아님).
- V5 회원 hero=respiration/hrv, 값 null → '측정 중', 값 있음 → 숫자.
- V6 재현: 합성 PPG 150초에 SDNN·호흡 산출(회귀 방지).
- 전체 vitest(기존 17건/8파일 실패 기준선)·tsc·eslint·build.
