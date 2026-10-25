#!/usr/bin/env bash
# measurement-core 전 타깃 빌드 + 시험. 개발자 개인 env 를 읽지 않는다(필요 환경변수는 아래 기본값).
#   ANDROID_NDK_BIN  NDK llvm bin (기본: /Volumes/Brian_SSD/androidsdk/ndk/27.2.12479018/android-ndk-r27c/toolchains/llvm/prebuilt/darwin-x86_64/bin)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
NDK_BIN="${ANDROID_NDK_BIN:-/Volumes/Brian_SSD/androidsdk/ndk/27.2.12479018/android-ndk-r27c/toolchains/llvm/prebuilt/darwin-x86_64/bin}"

echo "== cargo test (release, debug-hooks) =="
cargo test --release --features debug-hooks
echo "== wasm32-unknown-unknown =="
cargo build --release --target wasm32-unknown-unknown --features wasm
rm -rf pkg && wasm-bindgen target/wasm32-unknown-unknown/release/measurement_core.wasm --out-dir pkg --target nodejs
cargo run --release -q --example replay -- ../../contracts/biosignal-golden/v1/synth > target/native_replay.txt
node scripts/verify-wasm.mjs "$PWD/pkg" ../../contracts/biosignal-golden/v1/synth target/native_replay.txt
echo "== aarch64-linux-android =="
CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_BIN/aarch64-linux-android24-clang" AR_aarch64_linux_android="$NDK_BIN/llvm-ar" \
  cargo build --release --target aarch64-linux-android
echo "== aarch64-apple-ios =="
cargo build --release --target aarch64-apple-ios
echo "OK"
