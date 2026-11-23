# SDD-333 — 블루투스 꺼짐 안내 — 꺼짐 감지·안드로이드 켜기 버튼·iOS 시스템 켜기 창

- 상태: 구현 완료(대표 승인 2026-11-23)
- 브랜치: `sdd/333-bluetooth-off-guide`
- 작성일: 2026-11-23

## 문제
- 입장 밴드 단계가 블루투스 꺼짐을 권한 문제와 구분하지 못해 "Bluetooth 권한을 확인해 주세요"만 보인다.
- 수업 중 Android 네이티브는 꺼짐을 감지하지 못해 일반 끊김으로 처리 → 2분 뒤 SDD-331 "밴드 깨우기"가 잘못 뜬다. iOS는 `bluetooth_off` 이유가 있으나 화면에 안 보인다.

## 요구
1. 꺼짐 감지 3경로: JS `BleClient.startEnabledNotifications`, 앱 `AppSettings.isBluetoothEnabled`(2초 확인), 네이티브 snapshot `blocked_reason=bluetooth_off`(Android는 어댑터 꺼짐 시 플러그인이 채움, iOS 기존).
2. 꺼짐이면 입장 밴드 단계·수업 중 기기 시트에서 "블루투스가 꺼져 있어요" + 버튼을 깨우기 안내보다 우선 표시.
3. Android [블루투스 켜기]: `ACTION_REQUEST_ENABLE` 시스템 창(12+ BLUETOOTH_CONNECT 없으면 권한 요청 후 재시도), 거부·실패 시 `ACTION_BLUETOOTH_SETTINGS`.
4. iOS [블루투스 켜기]: `CBCentralManagerOptionShowPowerAlertKey` 시스템 알림. 비공개 URL(`App-Prefs:`) 금지. 알림 뒤 제어센터 안내 + [설정 열기](앱 설정).
5. 꺼짐→켜짐 즉시 빠른 재연결 창(SDD-331) 시작. 웹·구버전 앱은 버튼 숨김, 기존 문구.

## 범위 밖
백엔드 변경 없음. 밴드 펌웨어·재연결 정책 변경 없음.
