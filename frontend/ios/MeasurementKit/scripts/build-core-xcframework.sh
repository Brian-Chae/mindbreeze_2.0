#!/usr/bin/env bash
# Rust 측정 코어(packages/measurement-core) → xcframework(기기 arm64 + 시뮬레이터 arm64 + macOS arm64(swift test 용)).
# 산출물(Frameworks/)은 gitignore. 개발자 개인 env를 읽지 않는다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CORE="$HERE/../../../packages/measurement-core"
export PATH="$HOME/.cargo/bin:$PATH"
cd "$CORE"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin >/dev/null
cargo build --release --target aarch64-apple-ios
cargo build --release --target aarch64-apple-ios-sim
cargo build --release --target aarch64-apple-darwin
H="$(mktemp -d)"; trap 'rm -rf "$H"' EXIT
cp include/measurement_core.h "$H/"
printf 'module MeasurementCoreFFI {\n  header "measurement_core.h"\n  export *\n}\n' > "$H/module.modulemap"
OUT="$HERE/Frameworks/MeasurementCoreFFI.xcframework"
rm -rf "$OUT"
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libmeasurement_core.a -headers "$H" \
  -library target/aarch64-apple-ios-sim/release/libmeasurement_core.a -headers "$H" \
  -library target/aarch64-apple-darwin/release/libmeasurement_core.a -headers "$H" \
  -output "$OUT"
echo "OK $OUT"
