#!/usr/bin/env bash
# SDD-246 T12 — measurement-core 를 wasm32 로 빌드하고 wasm-bindgen --target web 산출물을 src/lib/measurement-web/wasm/ 에 배치한다.
# wasm-bindgen CLI 버전은 packages/measurement-core/Cargo.lock 의 wasm-bindgen 과 같아야 한다.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CRATE="$ROOT/packages/measurement-core"
OUT="$ROOT/frontend/src/lib/measurement-web/wasm"
LOCKED="$(awk '/name = "wasm-bindgen"$/{getline; gsub(/[^0-9.]/,"",$0); print; exit}' "$CRATE/Cargo.lock")"
HAVE="$(wasm-bindgen --version | awk '{print $2}')"
[ "$LOCKED" = "$HAVE" ] || { echo "wasm-bindgen CLI $HAVE != Cargo.lock $LOCKED" >&2; exit 1; }
(cd "$CRATE" && cargo build --release --target wasm32-unknown-unknown --features wasm --lib --locked)
rm -rf "$OUT" && mkdir -p "$OUT"
wasm-bindgen --target web --out-dir "$OUT" --out-name measurement_core "$CRATE/target/wasm32-unknown-unknown/release/measurement_core.wasm"
rm -f "$OUT"/*.d.ts.map
ls -l "$OUT"
