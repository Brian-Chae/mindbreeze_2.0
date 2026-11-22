# SDD-331 Summary

## 정책 값(3경로 동일)
빠른 창 120초 / 간격 2.5±0.5초 / 시도당 10초(Android 연결 단계 30→10초, 빠른 창 한정) / 이후 1·2·4·8·15·30초(±20%) / 느린 단계 직접 연결 2회 연속 실패 시 스캔 / 성공 시 리셋.

## 검증
- vitest: 신규 `sdd331-fast-reconnect-policy.test.ts` 8건 + facade android 1건 통과. BLE·밴드·재연결·회원 관련 28파일 246건 중 21건 실패 — `sdd222-band-reconnect.test.tsx`(`getBandIdentity is not a function`, SDD-326 목 누락)로, 변경 전(git stash)에서도 동일하게 21건.
- tsc 0, 변경 파일 eslint 0.
- iOS: `swift test` 불가(`MeasurementCoreFFI.xcframework` 바이너리 없음). `swiftc -parse` 3파일 통과 + `ReconnectBackoff` 를 떼어 독립 실행(48회·2~3초·느린 단계·스캔 전환·리셋) 통과. 새 XCTest 2건은 xcframework 있는 환경에서 실행 필요.
- Android: Kotlin 컴파일·JUnit 미실행(앱 빌드 금지). `BandReconnectPolicyTest.kt` 6건 작성, Gradle 환경에서 실행 필요.
- 캡처: `~/.hermes/share/sdd331-shots/wake-hint-390.png`(안내), `lost-normal-390.png`(대조).

## 위험·후속
- Android `scanThenConnect`·iOS 시도 타임아웃은 실기기 검증 필요(밴드 sleep 재현 후 2분 안 재연결).
- SDD-330(PR #328) 과 겹칠 수 있는 파일: `useBand.ts`, `MemberClassContainer.tsx`, `MemberSheets.tsx` — develop 기준이라 충돌은 머지 시 확인.
- 펌웨어 v1.44.4(연속 10분 끊김 후 sleep)는 밴드별 업데이트 전까지 앱 쪽 2분 창으로 대응.
