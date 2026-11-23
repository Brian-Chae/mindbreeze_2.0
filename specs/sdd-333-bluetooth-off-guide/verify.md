# SDD-333 verify (시나리오)
1. 꺼짐이 깨우기 안내보다 우선 — vitest `pickBandNotice`.
2. 꺼짐→켜짐 시 재연결 콜백 1회, 처음부터 켜짐이면 0회, 알 수 없음은 꺼짐 아님, 웹은 null — vitest `useBluetoothPower`.
3. 플랫폼별 버튼: Android 켜기 창 요청, iOS 켜기 알림 → 제어센터 안내 + 설정 열기, 웹 미표시, 12+ 권한 거절 후 재시도, 구버전 unavailable — vitest.
4. snapshot `bluetooth_off` → 기기 상태 전달 — vitest.
5. tsc 0, Android `compileDevDebugKotlin`/Java, iOS `swift test`(MeasurementKit), 하니스 캡처 390(입장·수업 중, Android/iOS).
6. 실기기(꺼짐 상태에서 시스템 창): 빌드 후 대표 확인 필요 — 자동 검증 불가.
