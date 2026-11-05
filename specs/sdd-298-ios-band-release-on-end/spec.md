# SDD-298 — iOS 클래스 종료 시 LINK BAND 연결 해제 누락 수정

- 상태: Stage ① Spec
- 브랜치: `sdd/298-ios-band-release-on-end`
- 작성일: 2026-11-05

## 문제
iOS 실기기에서 클래스를 종료해도 LINK BAND 연결이 해제되지 않는다(Android 는 정상).

## 코드 검증 결과 (결함표)
| # | 경로 | 위치 | 결함 | 심각도 |
|---|---|---|---|---|
| D1 | JS(웹 BLE) | `useCloseBiosignalOnEnd` / `MemberClassContainer.tsx:237` | 회차 `ended` 에서 close intent 만 기록, `band.disconnect()` 미호출 → GATT 연결 유지 | 확정(원인) |
| D2 | 네이티브 | `BandLink.disconnect()` | `peripheral` 가 nil(복원/인계 직후·retrieveConnected 미반영)이면 `cancelPeripheralConnection` 건너뜀 | 가설→로직상 가능 |
| D3 | 네이티브 | `centralManager(willRestoreState)` | `wantConnected=true` 로 되살림 — 종료 후 앱 재기동 복원이 재연결 유발 가능 | 보고만(소유: 293 인접) |
| D4 | 네이티브 | `didDisconnectPeripheral` | `scheduleRetry` 는 `wantConnected` 가드 있음 → 정상(결함 아님) | 정상 |
| D5 | 관측 | 해제 경로 | 해제 증명용 로그 부재 | 로깅 추가 |

## 범위
- JS: ended 후 close intent 기록이 끝나면 `band.disconnect()` 호출(이중 호출 안전).
- 네이티브: `disconnect()` 가 `peripheral` 없어도 연결된 밴드를 찾아 취소. `wantConnected=false` 고정. os_log 최소.
- 비범위: 대기실 인계(SDD-293), 진단(294/297).
