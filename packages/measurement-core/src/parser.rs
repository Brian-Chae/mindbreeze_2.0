//! LINK BAND 2.0 BLE 패킷 파서 — 바이트 정본은 공식 SDK `device.py`.
//!
//! - 헤더: uint32 **little endian**, 32768Hz tick (EEG/PPG/ACC 공통, PPG 포함).
//! - EEG: 샘플 7바이트 = leadoff(bit0=ch1, bit2=ch2) + BE signed24 ×2.
//!   µV = `signed * 4.033 / 12 / (2^23 - 1) * 1e6` (연산 순서 고정).
//! - PPG: 샘플 6바이트 = BE uint24 red, BE uint24 ir.
//! - ACC: 샘플 6바이트 = LE signed16 ×3, ±2g / 2^15.
//!
//! 최소 길이/나머지 바이트는 엄격 검사한다. 조용히 잘라내지 않고 오류로 돌려
//! 호출자가 원문을 보관하게 한다(plan §5.2).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensor {
    Eeg,
    Ppg,
    Acc,
}

impl Sensor {
    pub fn from_code(code: u8) -> Option<Sensor> {
        match code {
            0 => Some(Sensor::Eeg),
            1 => Some(Sensor::Ppg),
            2 => Some(Sensor::Acc),
            _ => None,
        }
    }
    pub fn code(self) -> u8 {
        match self {
            Sensor::Eeg => 0,
            Sensor::Ppg => 1,
            Sensor::Acc => 2,
        }
    }
    /// 계약 packet_rules.min_len (SDK `_handle_*` 의 최소 길이 검사)
    pub fn min_len(self) -> usize {
        match self {
            Sensor::Eeg | Sensor::Ppg => 8,
            Sensor::Acc => 10,
        }
    }
    pub fn sample_size(self) -> usize {
        match self {
            Sensor::Eeg => 7,
            Sensor::Ppg | Sensor::Acc => 6,
        }
    }
    pub fn rate_hz(self) -> u32 {
        match self {
            Sensor::Eeg => 250,
            Sensor::Ppg => 50,
            Sensor::Acc => 30,
        }
    }
    /// 샘플 간격(µs). ACC 는 기존 웹 profile v1 의 반올림 값(33333)을 유지한다(D09).
    pub fn interval_us(self) -> i64 {
        match self {
            Sensor::Eeg => 4_000,
            Sensor::Ppg => 20_000,
            Sensor::Acc => 33_333,
        }
    }
    pub fn index(self) -> usize {
        self.code() as usize
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    /// 헤더 4바이트 미만 (계약 invalid_header_short)
    HeaderShort { got: usize },
    /// 최소 길이 미만 (계약 invalid_too_short: eeg/ppg 8, acc 10 — SDK 의 최소 길이 검사)
    TooShort { got: usize, need: usize },
    /// 샘플 크기로 나누어 떨어지지 않는 꼬리 바이트
    TrailingBytes { extra: usize },
}

#[derive(Debug, Clone, PartialEq)]
pub struct EegSample {
    pub raw_ch1: i32,
    pub raw_ch2: i32,
    pub ch1_uv: f64,
    pub ch2_uv: f64,
    pub leadoff_ch1: bool,
    pub leadoff_ch2: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PpgSample {
    pub red: u32,
    pub ir: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AccSample {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Packet<S> {
    pub header_raw: u32,
    pub samples: Vec<S>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Parsed {
    Eeg(Packet<EegSample>),
    Ppg(Packet<PpgSample>),
    Acc(Packet<AccSample>),
}

impl Parsed {
    pub fn header_raw(&self) -> u32 {
        match self {
            Parsed::Eeg(p) => p.header_raw,
            Parsed::Ppg(p) => p.header_raw,
            Parsed::Acc(p) => p.header_raw,
        }
    }
    pub fn n_samples(&self) -> usize {
        match self {
            Parsed::Eeg(p) => p.samples.len(),
            Parsed::Ppg(p) => p.samples.len(),
            Parsed::Acc(p) => p.samples.len(),
        }
    }
}

/// FNV-1a 64bit — payload 중복 판정용 결정적 해시(암호학적 용도 아님).
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn signed24(b0: u8, b1: u8, b2: u8) -> i32 {
    let raw = ((b0 as i32) << 16) | ((b1 as i32) << 8) | (b2 as i32);
    if raw & 0x80_0000 != 0 {
        raw - 0x100_0000
    } else {
        raw
    }
}

/// EEG µV 변환 — JS 원본과 같은 연산 순서(좌→우)를 유지한다.
fn eeg_uv(signed: i32) -> f64 {
    (signed as f64) * 4.033 / 12.0 / (8_388_608.0 - 1.0) * 1e6
}

pub fn parse_packet(sensor: Sensor, bytes: &[u8]) -> Result<Parsed, ParseError> {
    let size = sensor.sample_size();
    if bytes.len() < 4 {
        return Err(ParseError::HeaderShort { got: bytes.len() });
    }
    let need = sensor.min_len();
    if bytes.len() < need {
        return Err(ParseError::TooShort { got: bytes.len(), need });
    }
    let body = bytes.len() - 4;
    let extra = body % size;
    if extra != 0 {
        return Err(ParseError::TrailingBytes { extra });
    }
    let header_raw = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let n = body / size;
    let data = &bytes[4..];
    Ok(match sensor {
        Sensor::Eeg => {
            let mut samples = Vec::with_capacity(n);
            for i in 0..n {
                let o = i * 7;
                let lo = data[o];
                let c1 = signed24(data[o + 1], data[o + 2], data[o + 3]);
                let c2 = signed24(data[o + 4], data[o + 5], data[o + 6]);
                samples.push(EegSample {
                    raw_ch1: c1,
                    raw_ch2: c2,
                    ch1_uv: eeg_uv(c1),
                    ch2_uv: eeg_uv(c2),
                    leadoff_ch1: lo & 0x01 != 0,
                    leadoff_ch2: lo & 0x04 != 0,
                });
            }
            Parsed::Eeg(Packet { header_raw, samples })
        }
        Sensor::Ppg => {
            let mut samples = Vec::with_capacity(n);
            for i in 0..n {
                let o = i * 6;
                let red = ((data[o] as u32) << 16) | ((data[o + 1] as u32) << 8) | data[o + 2] as u32;
                let ir = ((data[o + 3] as u32) << 16) | ((data[o + 4] as u32) << 8) | data[o + 5] as u32;
                samples.push(PpgSample { red, ir });
            }
            Parsed::Ppg(Packet { header_raw, samples })
        }
        Sensor::Acc => {
            let scale = 2.0 / 32768.0;
            let mut samples = Vec::with_capacity(n);
            for i in 0..n {
                let o = i * 6;
                let x = i16::from_le_bytes([data[o], data[o + 1]]);
                let y = i16::from_le_bytes([data[o + 2], data[o + 3]]);
                let z = i16::from_le_bytes([data[o + 4], data[o + 5]]);
                samples.push(AccSample { x: x as f64 * scale, y: y as f64 * scale, z: z as f64 * scale });
            }
            Parsed::Acc(Packet { header_raw, samples })
        }
    })
}
