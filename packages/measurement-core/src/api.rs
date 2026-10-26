//! JSON 경계(contracts/measurement-bridge/schema/core-abi.schema.json) — C ABI 와 WASM 이 공유한다.
//! 입력 JSON 은 unknown 필드를 거절하고, 결과/오류는 항상 계약 형태로 직렬화한다.

use crate::dsp::score::{ModelParams, SigmoidParam};
use crate::engine::{Core, CoreConfig, CoreError, ErrorCode, WallAnchor};
use crate::parser::Sensor;
use base64::Engine;
use serde::{Deserialize, Deserializer};

pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
}
impl ApiError {
    pub fn new(code: ErrorCode, m: impl Into<String>) -> Self {
        ApiError { code, message: m.into() }
    }
    pub fn to_json(&self) -> String {
        serde_json::to_string(&CoreError::new(self.code, &self.message)).unwrap()
    }
}

fn u64_str<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum V {
        S(String),
        N(u64),
    }
    match V::deserialize(d)? {
        V::N(n) => Ok(n),
        V::S(s) => {
            if s.is_empty() || (s.len() > 1 && s.starts_with('0')) || !s.bytes().all(|b| b.is_ascii_digit()) {
                return Err(serde::de::Error::custom("U64 십진 문자열이 아님"));
            }
            s.parse::<u64>().map_err(|_| serde::de::Error::custom("u64 overflow"))
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WallAnchorIn {
    wall_ms: u64,
    #[serde(deserialize_with = "u64_str")]
    monotonic_us: u64,
    uncertainty_ms: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PushCallIn {
    sensor: String,
    bytes_base64: String,
    #[serde(deserialize_with = "u64_str")]
    arrival_monotonic_us: u64,
    wall_anchor: WallAnchorIn,
}

pub fn parse_config(json: &[u8]) -> Result<CoreConfig, ApiError> {
    let cfg: CoreConfig = serde_json::from_slice(json).map_err(|e| ApiError::new(ErrorCode::InvalidConfig, format!("config 파싱: {e}")))?;
    cfg.validate().map_err(|m| ApiError::new(ErrorCode::InvalidConfig, m))?;
    Ok(cfg)
}

pub fn sensor_from_str(s: &str) -> Option<Sensor> {
    match s {
        "eeg" => Some(Sensor::Eeg),
        "ppg" => Some(Sensor::Ppg),
        "acc" => Some(Sensor::Acc),
        _ => None,
    }
}

pub fn push_json(core: &mut Core, call: &[u8]) -> Result<String, ApiError> {
    let c: PushCallIn = serde_json::from_slice(call).map_err(|e| ApiError::new(ErrorCode::InvalidArgument, format!("push 파싱: {e}")))?;
    if c.wall_anchor.uncertainty_ms.is_nan() || !(0.0..=300_000.0).contains(&c.wall_anchor.uncertainty_ms) {
        return Err(ApiError::new(ErrorCode::InvalidArgument, "uncertainty_ms 범위 밖"));
    }
    let sensor = sensor_from_str(&c.sensor).ok_or_else(|| ApiError::new(ErrorCode::InvalidArgument, "sensor"))?;
    if c.bytes_base64.len() > 4096 {
        return Err(ApiError::new(ErrorCode::InvalidArgument, "bytes_base64 4096 초과"));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(c.bytes_base64.as_bytes())
        .map_err(|_| ApiError::new(ErrorCode::InvalidArgument, "base64"))?;
    let out = core.push_packet(sensor, &bytes, c.arrival_monotonic_us, WallAnchor { wall_ms: c.wall_anchor.wall_ms, monotonic_us: c.wall_anchor.monotonic_us });
    Ok(serde_json::to_string(&out).unwrap())
}

pub fn push_raw(core: &mut Core, sensor: u8, bytes: &[u8], arrival_us: u64, wall_ms: u64, anchor_mono_us: u64) -> Result<String, ApiError> {
    let sensor = Sensor::from_code(sensor).ok_or_else(|| ApiError::new(ErrorCode::InvalidArgument, "sensor code"))?;
    let out = core.push_packet(sensor, bytes, arrival_us, WallAnchor { wall_ms, monotonic_us: anchor_mono_us });
    Ok(serde_json::to_string(&out).unwrap())
}

pub fn advance_json(core: &mut Core, monotonic_us: u64) -> String {
    serde_json::to_string(&core.advance(monotonic_us)).unwrap()
}

pub fn close_json(core: &mut Core) -> String {
    serde_json::to_string(&core.close()).unwrap()
}

/// 활성 sigmoid 모델 params: {"focusIndex":{"m":..,"s":..,"direction":1}, ...}
pub fn set_model_json(core: &mut Core, json: &[u8]) -> Result<(), ApiError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct P {
        m: f64,
        s: f64,
        direction: i8,
    }
    let raw: std::collections::BTreeMap<String, P> = serde_json::from_slice(json).map_err(|e| ApiError::new(ErrorCode::InvalidArgument, format!("model 파싱: {e}")))?;
    let mut m = ModelParams::new();
    for (k, p) in raw {
        if !(p.direction == 1 || p.direction == -1) || !p.m.is_finite() || !(p.s > 0.0) || !p.s.is_finite() {
            return Err(ApiError::new(ErrorCode::InvalidArgument, format!("model param {k} 값 오류")));
        }
        m.insert(k, SigmoidParam { m: p.m, s: p.s, direction: p.direction });
    }
    core.set_model(m);
    Ok(())
}
