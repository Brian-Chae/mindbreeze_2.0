# SDD-293 — 밴드 조기 네이티브 인계 (클래스 시작 시 재연결 제거)

- 상태: Stage ① Spec
- 브랜치: `sdd/293-band-early-handoff` (develop 687967bb 기반)
- 작성일: 2026-11-05

## 배경 (실기기 로그)
- Android vc35: 대기실에서 JS BLE 가 밴드에 연결 → 클래스 시작(`session.start`) 때 JS 가 연결 해제(10:27:12.093) → 0.75초 뒤 네이티브가 같은 주소로 재연결(10:27:12.849).
- iOS(대표 실기기): 같은 흐름에서 해제 후 재연결이 매우 오래 걸림. 원인 후보 = 네이티브 `BandLink.attempt()` 의 `retrieveConnectedPeripherals`/pending connect 경로(코드 확정은 plan §3).
- 40대가 클래스 시작 신호로 같은 초에 끊고 붙는다 → 2.4GHz 순간 혼잡, Android GATT 133. 밴드는 자체 저장소가 없어 끊긴 구간은 복구 불가.

## 목표
1. 밴드 연결 단계를 마치면 곧바로 네이티브가 밴드를 인계받아 **보류(hold) 상태**로 쥔다(클래스 시작을 기다리지 않음). 인계 시각이 사람마다 달라 40대가 한 순간에 몰리지 않는다.
2. 인계 전후 화면의 밴드 상태는 연속(연결됨 유지). "연결 중/다시 연결"을 인계 때문에 띄우지 않는다. 실제 실패·끊김은 현행대로 표시.
3. 측정 시작(`capture.start`, 스트림 확정)은 클래스 시작 때만. 보류 상태에서는 서버 스트림·분석 업로드·데이터 구독 없음(동의·참여 규칙 불변).
4. 대상 = 로그인 회원 + native 경로 + `bandOptIn` + EEG 동의. 게스트·웹·미동의는 현행 JS 경로.
5. 클래스 시작 시 새 연결 0회(JS 해제 호출 없음, `startMeasurement` 만). 시작 없이 화면을 떠나면 네이티브가 밴드를 확실히 해제.
6. 종료 시 밴드 해제가 Android·iOS·JS 경로 모두 보장되는지 확인하고 누락(JS 경로)은 이번에 고친다.

## 범위 밖
- 앱 빌드·배포, 진단 패널(`connection-diagnostics-model.ts`, `ConnectionDiagnosticsPanel`, `MemberSheets` = SDD-294/297), 훅 `diagnostics` 객체 구성부(SDD-296).
- 밴드 데이터 복구(밴드 자체 저장소 없음).

## 결정 (감독 확인 필요 항목 표시)
- 인계 시점 = **밴드 단계(c) 완료 직후**(`bandOutcome==='connected'`). 단계 c 는 JS 데이터로 접촉(전극) 상태를 보여 주므로, 연결 즉시 인계하면 접촉 확인 화면이 죽는다. 그 외에는 대기실 진입 시각 분산 효과 동일.
- 브리지 계약: 신규 메서드 `adoptBand`·`releaseBand` 는 additive(optional), `bridge_version` 불변. 구 네이티브(미구현) 이면 JS 가 기존 경로로 폴백.
