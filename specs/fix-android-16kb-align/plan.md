# FIX — Android 16KB 페이지 정렬 (plan)

## 원인
- `libmeasurement_core.so`(arm64): Rust cdylib 가 기본 max-page-size=4096 으로 링크되어 PT_LOAD p_align=4096, LOAD 3개 (vaddr-offset)%16384!=0.
- `libjnidispatch.so`(x86_64): JNA 5.14.0 의 x86_64 는 4096 정렬. (arm64 는 65536 으로 정상)

## 수정
1. `packages/measurement-core/.cargo/config.toml` 에 Android 타깃 전체(aarch64/armv7/x86_64/i686)에 `-Wl,-z,max-page-size=16384`, `-Wl,-z,common-page-size=16384` 링크 인자 추가. gradle·build-all.sh 모두 이 설정을 공통으로 탄다(env RUSTFLAGS 미사용).
2. JNA 5.14.0 → 5.17.0 (16KB 정렬 .so 포함 버전) — aar·testImplementation 둘 다. 불가하면 prod 번들에서 x86_64 제외하고 사유를 summary 에 기록.
3. `scripts/check-16kb-align.sh`: APK/AAB/디렉터리의 모든 .so 에 대해 llvm-readelf -l 로 LOAD p_align>=16384, (vaddr-offset)%16384==0 표 검증. APK 는 zipalign -c -P 16 -v 4 병행.
