# FIX — Android 16KB 페이지 정렬 (summary)

## 변경
- `packages/measurement-core/.cargo/config.toml`: Android 4개 타깃에 `-Wl,-z,max-page-size=16384`, `common-page-size=16384` (gradle·build-all.sh 공통 적용)
- `frontend/android/app/build.gradle`: JNA 5.14.0 → 5.17.0 (aar·시험 의존성). x86_64 ABI 제외는 불필요해 채택하지 않음.
- `scripts/check-16kb-align.sh`: AAB/APK/디렉터리의 모든 .so LOAD 정렬 검사 + APK는 zipalign -c -P 16 -v 4

## 전후 (arm64 / x86_64 핵심, 수정 전 값은 AAB versionCode 12 독립 검증 기준)
| .so | 수정 전 | 수정 후 |
|---|---|---|
| arm64-v8a/libmeasurement_core.so | p_align 4096, LOAD 3개 (vaddr-offset)%16384≠0 | LOAD 4개 모두 16384, 오프셋 정렬 OK |
| x86_64/libjnidispatch.so | p_align 4096 | 16384 OK |
| arm64 libjnidispatch / datastore | 65536 / 16384 | 16384 이상 OK (유지) |

수정 후 AAB(prodRelease, versionCode 99) .so 12개(arm64-v8a, armeabi-v7a, armeabi, mips, mips64, x86, x86_64) 전부 PASS.
bundletool universal APK: zipalign -c -P 16 -v 4 "Verification succesful".

## 시험
- cargo test --release --features debug-hooks: 전 항목 통과(5+8+4+2+4+11, 실패 0)
- ./gradlew testDevDebugUnitTest: 125건, 실패 0, 오류 0, 건너뜀 0

## 비고
- 신규 worktree에서 AAB 빌드하려면 `npm run build:prod && npx cap sync android` 선행 필요(cordova.variables.gradle 생성).
- cap sync가 바꾸는 capacitor.settings.gradle은 되돌렸고, keystore.properties는 gitignore 대상이라 커밋하지 않음.
- contracts/ 미수정, 런타임 우회·바이너리 패치 없음.
