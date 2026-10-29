# [Fix] iOS 클래스 입장 시 밴드 재연결 고착 — 원인분석·계획

## 증상 (대표 실기기, iOS 빌드 21)
대기 화면에서 밴드 연결 → 클래스 화면 진입 순간 '연결 끊김' → '밴드를 연결하는 중이에요' 고착, 데이터 없음. 밴드 LED는 연결 유지.

## 확인된 사실
- 서버(dev): 오늘(10/29) iOS 소켓 흔적 없음. `/session-live` 로그는 '잘못된 토큰' 거부 3건(UTC 00:25/01:09/01:30)뿐. 감독이 지목한 회차 e0020590은 **10/26 생성 회차**(ledger: protocol.pin·session.start만, capture_stream 0)라 이번 제보의 증거가 아님. 오늘 iOS 회차(45997c50 등)도 capture_stream 0건.
- 기기 로그(devicectl/Console): 연결된 기기 없음(unavailable) → 확보 못 함.

## 코드 추적 결과 (결함 후보 1건 확정)
핸드오프: `use-native-measurement` → `facade.startForSession` → `releaseForNative()`(JS 연결 해제, 캐시 ID 삭제) → `setJSBandOwnership(false)` → `startMeasurement(peripheralId?)`.
- `BandLink.attempt()`(BandBLE.swift)는 **expected ID가 없으면 곧바로 스캔**한다. 이미 연결된 밴드는 광고하지 않아 스캔으로 안 보인다 → 'connecting/scanning'에서 영구 고착, 앱 화면은 '밴드를 연결하는 중'.
- `retrieveConnectedPeripherals`는 expected ID가 있을 때만 쓰였다. `releaseForNative`가 돌려주는 연결 ID도 버려지고 있었다.

## 수정
1. `BandLink.attempt()`: ID가 없어도 이미 연결된 LINK BAND(`retrieveConnectedPeripherals`)를 먼저 집는다. 선택 규칙은 순수 함수 `PeripheralPick.choose`로 분리.
2. `facade.startForSession`(iOS): `releaseJsBand()`가 돌려준 연결 ID를 저장 ID가 비었을 때 `peripheralId`로 넘긴다.

## 한계 (정직)
위 결함이 이번 증상의 유일한 원인인지는 기기 로그 없이 확정할 수 없다. 저장된 deviceId가 있는 경로(대부분)에선 기존에도 ID를 넘겼으므로, 재현 시 Xcode Console의 `capture.start 송신`·`band_state`·`live 연결 오류` os_log 확인이 필요하다.
