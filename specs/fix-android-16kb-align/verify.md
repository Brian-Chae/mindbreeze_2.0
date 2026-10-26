# FIX — Android 16KB 페이지 정렬 (verify, 구현 전 작성)

| # | 시나리오 | 통과 기준 |
|---|---|---|
| V1 | prod release 빌드 `./gradlew bundleProdRelease -PversionCode=99` | 성공(서명 불가 시 assembleProdRelease) |
| V2 | 산출물 모든 ABI·모든 .so `llvm-readelf -l` | 모든 LOAD p_align>=16384 이고 (vaddr-offset)%16384==0, 표로 기록 |
| V3 | APK(AAB는 bundletool universal APK) `zipalign -c -P 16 -v 4` | 통과 |
| V4 | `cargo test --release --features debug-hooks` (골든 패리티·oracle) | 회귀 0 |
| V5 | `./gradlew testDevDebugUnitTest` | 회귀 0 |
| V6 | 수정 전(베이스라인) 정렬표 확보 | 전후 비교 가능 |
| V7 | 금지: 런타임 우회·바이너리 패치·contracts/ 수정 없음 | git diff 로 확인 |
