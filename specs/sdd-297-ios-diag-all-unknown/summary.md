# SDD-297 Summary

## 확정 원인(코드 대조, 실기기 로그 없음)
iOS 는 저장 진행 이벤트(`feature.counts`·`archive.counts`)를 SessionSync 변화 때만 내보낸다(Android 는 2초마다 무조건). SessionSync 가 늦게 만들어지거나 변화가 없으면 이벤트가 0건 → `uploadProgressStore` 가 영구 null → 진단 `upload=null` → 두 줄 모두 "확인 전".
payload 키·이벤트 이름은 Android 와 동일(차이 없음). iOS snapshot 은 매 `measurementUpdated` 에 `archive.queue`(live_pending·live_acked·archive_pending·archive_verified)를 이미 싣지만 JS 가 읽지 않았다.

## 수정(웹만, 네이티브 변경 없음)
- `use-native-measurement.ts`: `uploadPatchFromSnapshot()` 추가. 이벤트 미수신 세션에서 snapshot 으로 스토어 시드. 이벤트 수신 후엔 이벤트 우선. diagnostics 가 `useSyncExternalStore` 로 스토어 구독.
- 시험 `tests/sdd297-ios-diag-unknown.test.tsx` 6건(RED 6/6 → GREEN 6/6).

## 시험
tsc -b 0 / sdd297 6 + sdd284 두 파일(진단 23건 포함)·sdd260-web·sdd266·sdd264-report 합 104건 통과 / 전체 vitest 는 도중 시간 초과로 끝까지 못 봄 / 기존 실패 `measure-guard-null-display`(MemberClassContainer v2) 1건은 base 687967bb 에서도 동일 실패.

## 못 한 것
- iOS 실기기 확인(감독 설치 후 진단 줄 값과 `diagPath` 확인 필요). 빌드 2 가 native 경로가 아니라 web_wasm/게스트면 upload=null 은 의도 동작이라 이 수정으로 안 바뀐다.
- 앱 재빌드: 웹 번들 변경이므로 iOS 앱은 `cap sync` 후 재빌드 필요(네이티브 코드는 불변).
