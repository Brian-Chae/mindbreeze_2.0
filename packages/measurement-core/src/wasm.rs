//! wasm-bindgen 바인딩 (feature `wasm`, wasm32-unknown-unknown). Web Worker 단일 스레드 기준.
//! JSON 경계는 C ABI 와 동일(src/api.rs 공유). 오류는 JS 예외(`Error`)가 아니라
//! `{ok:false,error:{code,message}}` 값으로 돌려준다 → 호출 측이 panic/throw 와 구분 가능.
//! 핸들 객체(`McCore`)는 JS 가 `free()` 를 호출해 해제한다(wasm-bindgen 표준).

use crate::api::*;
use crate::engine::{Core, ErrorCode, Tuning};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct McCore {
    inner: Core,
}

fn ok(json: String) -> String {
    format!("{{\"ok\":true,\"value\":{json}}}")
}
fn err(e: ApiError) -> String {
    format!("{{\"ok\":false,\"error\":{}}}", e.to_json())
}

#[wasm_bindgen(js_name = abiVersion)]
pub fn wasm_abi_version() -> u32 {
    crate::engine::ABI_VERSION
}

#[wasm_bindgen]
impl McCore {
    /// config_json: 계약 CoreConfig. 실패 시 JS 예외(생성자 제약) — 메시지는 계약 CoreError JSON.
    #[wasm_bindgen(constructor)]
    pub fn new(config_json: &str) -> Result<McCore, JsValue> {
        let cfg = parse_config(config_json.as_bytes()).map_err(|e| JsValue::from_str(&e.to_json()))?;
        let inner = Core::with_tuning(cfg, Tuning::default()).map_err(|m| JsValue::from_str(&ApiError::new(ErrorCode::InvalidConfig, m).to_json()))?;
        Ok(McCore { inner })
    }

    pub fn restore(config_json: &str, checkpoint: &[u8]) -> Result<McCore, JsValue> {
        let cfg = parse_config(config_json.as_bytes()).map_err(|e| JsValue::from_str(&e.to_json()))?;
        let inner = Core::restore(cfg, checkpoint).map_err(|m| JsValue::from_str(&ApiError::new(ErrorCode::CheckpointCorrupt, m).to_json()))?;
        Ok(McCore { inner })
    }

    pub fn set_model(&mut self, model_json: &str) -> String {
        match set_model_json(&mut self.inner, model_json.as_bytes()) {
            Ok(()) => ok("null".into()),
            Err(e) => err(e),
        }
    }

    /// 계약 PushPacketCall(JSON)
    pub fn push_packet(&mut self, call_json: &str) -> String {
        match push_json(&mut self.inner, call_json.as_bytes()) {
            Ok(j) => ok(j),
            Err(e) => err(e),
        }
    }

    /// 바이너리 직접 투입(Web Bluetooth DataView → Uint8Array). sensor: 0=eeg 1=ppg 2=acc.
    /// u64 는 JS number(안전 정수 범위)로 받는다: 호출자가 경계를 지켜야 한다.
    pub fn push_packet_raw(&mut self, sensor: u8, bytes: &[u8], arrival_monotonic_us: f64, wall_ms: f64, anchor_monotonic_us: f64) -> String {
        const MAX: f64 = 9_007_199_254_740_991.0;
        for v in [arrival_monotonic_us, wall_ms, anchor_monotonic_us] {
            if !(0.0..=MAX).contains(&v) || v.fract() != 0.0 {
                return err(ApiError::new(ErrorCode::InvalidArgument, "시각은 0..2^53 정수"));
            }
        }
        match push_raw(&mut self.inner, sensor, bytes, arrival_monotonic_us as u64, wall_ms as u64, anchor_monotonic_us as u64) {
            Ok(j) => ok(j),
            Err(e) => err(e),
        }
    }

    pub fn advance(&mut self, monotonic_us: f64) -> String {
        if !(0.0..=9_007_199_254_740_991.0).contains(&monotonic_us) {
            return err(ApiError::new(ErrorCode::InvalidArgument, "monotonic_us 범위"));
        }
        ok(advance_json(&mut self.inner, monotonic_us as u64))
    }

    pub fn checkpoint(&self) -> Vec<u8> {
        self.inner.checkpoint()
    }

    pub fn close(&mut self) -> String {
        ok(close_json(&mut self.inner))
    }
}
