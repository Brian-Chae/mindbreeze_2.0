# SDD-333 summary
- 구현: plan.md 그대로. 꺼짐 안내가 깨우기 안내보다 우선, Android 켜기 시스템 창(+설정 폴백), iOS 시스템 켜기 알림(+제어센터·설정 열기), 켜짐 전환 즉시 재연결.
- 검증: vitest 527 통과(관련 37파일, 신규 15), tsc 0, Android compileDevDebugKotlin/Java 성공, iOS `swift test` 280 통과(7 skip 기존), 390 캡처 확인.
- 한계: 실기기에서 시스템 창이 뜨는 동작은 자동 검증 불가(대표 확인 필요). iOS 시스템 알림은 OS가 반복 노출을 억제할 수 있어 제어센터 안내를 함께 둠.
