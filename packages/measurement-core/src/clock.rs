//! 센서별 독립 시계 — 32bit tick wrap 확장, segment, 중복/충돌, 미래·벽시계 방어.
//!
//! v1 profile (D09): 패킷 헤더 tick 은 **마지막 샘플** 기준이다(현 웹 동작 보존).
//! 샘플 시각은 장치 tick 으로만 정해지며 arrival jitter 로 간격을 다시 만들지 않는다.
//! 벽시계(`wall_us`)는 앵커에서만 쓴다: `wall = anchor_wall + (ext - anchor_ext) / 32768`.

use crate::parser::Sensor;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const TICK_HZ: i64 = 32_768;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ClockConfig {
    /// 이 값 이상 과거로 돌아가면 tick reset(새 segment). 미만이면 순서 역행.
    pub reset_back_ticks: i64,
    /// 장치 시각이 도착 벽시계보다 이만큼 앞서면 미래로 보고 재앵커(µs).
    pub future_tolerance_us: i64,
    /// 예측 벽시계와 실제 도착 벽시계가 이 이상 어긋나면 clock_uncertain(µs, ±5분).
    pub wall_divergence_us: i64,
    pub recent_cap: usize,
}

impl Default for ClockConfig {
    fn default() -> Self {
        ClockConfig {
            reset_back_ticks: 2 * TICK_HZ,
            future_tolerance_us: 5_000_000,
            wall_divergence_us: 300_000_000,
            recent_cap: 64,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Accept,
    /// 같은 (sensor,segment,tick,hash) 재수신 — 분석 제외, 원문은 duplicate metadata 로 보존
    Duplicate,
    /// 같은 tick 다른 payload — 분석 제외, 원문 보존
    Conflict,
    /// 직전보다 과거(reset 미만) 새 payload — 분석 제외
    OutOfOrder,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Flags {
    pub segment_reset: bool,
    pub future: bool,
    pub reanchored: bool,
    pub clock_uncertain: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Admission {
    pub verdict: Verdict,
    pub segment: u32,
    pub ext_tick: i64,
    /// 마지막 샘플의 벽시계(µs)
    pub last_sample_wall_us: i64,
    /// 헤더 점프로 추정한 누락 샘플 수(이 패킷 직전)
    pub gap_samples: u32,
    pub anchor_id: u32,
    pub flags: Flags,
    pub n_samples: u32,
    pub interval_us: i64,
}

impl Admission {
    /// 패킷 내 i번째 샘플의 벽시계(µs). 헤더가 마지막 샘플이므로 앞으로 보간한다.
    pub fn sample_wall_us(&self, i: usize) -> i64 {
        self.last_sample_wall_us - (self.n_samples as i64 - 1 - i as i64) * self.interval_us
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct State {
    last_raw: u32,
    last_ext: i64,
    anchor_ext: i64,
    anchor_wall_us: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ClockStats {
    pub accepted: u64,
    pub duplicates: u64,
    pub conflicts: u64,
    pub out_of_order: u64,
    pub segment_resets: u64,
    pub reanchors: u64,
    pub gap_samples: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorClock {
    sensor: Sensor,
    cfg: ClockConfig,
    state: Option<State>,
    segment: u32,
    anchor_id: u32,
    recent: VecDeque<(i64, u64)>,
    pub stats: ClockStats,
}

/// 정수 반올림 나눗셈(half up). 분모 > 0.
fn div_round(num: i128, den: i128) -> i128 {
    (2 * num + den).div_euclid(2 * den)
}

fn ticks_to_us(ticks: i64) -> i64 {
    div_round(ticks as i128 * 1_000_000, TICK_HZ as i128) as i64
}

impl SensorClock {
    pub fn new(sensor: Sensor, cfg: ClockConfig) -> Self {
        SensorClock { sensor, cfg, state: None, segment: 0, anchor_id: 0, recent: VecDeque::new(), stats: ClockStats::default() }
    }

    pub fn segment(&self) -> u32 {
        self.segment
    }

    fn remember(&mut self, ext: i64, hash: u64) {
        self.recent.push_back((ext, hash));
        while self.recent.len() > self.cfg.recent_cap {
            self.recent.pop_front();
        }
    }

    fn skip(&self, verdict: Verdict, ext: i64, n: usize) -> Admission {
        Admission {
            verdict,
            segment: self.segment,
            ext_tick: ext,
            last_sample_wall_us: 0,
            gap_samples: 0,
            anchor_id: self.anchor_id,
            flags: Flags::default(),
            n_samples: n as u32,
            interval_us: self.sensor.interval_us(),
        }
    }

    /// 패킷 1개를 시계에 투입한다. `raw` 는 헤더 tick(uint32), `wall_us` 는 BLE 도착 벽시계.
    pub fn admit(&mut self, raw: u32, payload_hash: u64, n_samples: usize, wall_us: i64) -> Admission {
        let interval_us = self.sensor.interval_us();
        let Some(st) = self.state else {
            let st = State { last_raw: raw, last_ext: raw as i64, anchor_ext: raw as i64, anchor_wall_us: wall_us };
            self.state = Some(st);
            self.remember(raw as i64, payload_hash);
            self.stats.accepted += 1;
            return Admission {
                verdict: Verdict::Accept,
                segment: self.segment,
                ext_tick: raw as i64,
                last_sample_wall_us: wall_us,
                gap_samples: 0,
                anchor_id: self.anchor_id,
                flags: Flags::default(),
                n_samples: n_samples as u32,
                interval_us,
            };
        };

        let d = raw.wrapping_sub(st.last_raw) as i32 as i64;
        let ext = st.last_ext + d;

        if let Some(&(_, h)) = self.recent.iter().find(|(t, _)| *t == ext) {
            return if h == payload_hash {
                self.stats.duplicates += 1;
                self.skip(Verdict::Duplicate, ext, n_samples)
            } else {
                self.stats.conflicts += 1;
                self.skip(Verdict::Conflict, ext, n_samples)
            };
        }

        if d <= 0 {
            if -d < self.cfg.reset_back_ticks {
                self.stats.out_of_order += 1;
                return self.skip(Verdict::OutOfOrder, ext, n_samples);
            }
            // tick reset(재연결·장치 재시작): 새 segment, 도착 벽시계에 재앵커.
            self.segment += 1;
            self.anchor_id += 1;
            self.recent.clear();
            self.state = Some(State { last_raw: raw, last_ext: raw as i64, anchor_ext: raw as i64, anchor_wall_us: wall_us });
            self.remember(raw as i64, payload_hash);
            self.stats.accepted += 1;
            self.stats.segment_resets += 1;
            self.stats.reanchors += 1;
            return Admission {
                verdict: Verdict::Accept,
                segment: self.segment,
                ext_tick: raw as i64,
                last_sample_wall_us: wall_us,
                gap_samples: 0,
                anchor_id: self.anchor_id,
                flags: Flags { segment_reset: true, reanchored: true, ..Flags::default() },
                n_samples: n_samples as u32,
                interval_us,
            };
        }

        // 정상 전진: 누락 샘플 추정(= 경과 샘플 수 - 이 패킷 샘플 수)
        let elapsed_samples = d as f64 * self.sensor.rate_hz() as f64 / TICK_HZ as f64;
        let gap_f = (elapsed_samples - n_samples as f64 + 0.5).floor();
        let gap_samples = if gap_f > 0.0 { gap_f as u32 } else { 0 };

        let mut anchor_ext = st.anchor_ext;
        let mut anchor_wall = st.anchor_wall_us;
        let predicted = anchor_wall + ticks_to_us(ext - anchor_ext);
        let diff = predicted - wall_us;
        let mut flags = Flags::default();
        if diff.abs() > self.cfg.wall_divergence_us {
            flags.clock_uncertain = true;
            flags.reanchored = true;
        }
        if diff > self.cfg.future_tolerance_us {
            flags.future = true;
            flags.reanchored = true;
        }
        let last_sample_wall_us = if flags.reanchored {
            anchor_ext = ext;
            anchor_wall = wall_us;
            self.anchor_id += 1;
            self.stats.reanchors += 1;
            wall_us
        } else {
            predicted
        };

        self.state = Some(State { last_raw: raw, last_ext: ext, anchor_ext, anchor_wall_us: anchor_wall });
        self.remember(ext, payload_hash);
        self.stats.accepted += 1;
        self.stats.gap_samples += gap_samples as u64;
        Admission {
            verdict: Verdict::Accept,
            segment: self.segment,
            ext_tick: ext,
            last_sample_wall_us,
            gap_samples,
            anchor_id: self.anchor_id,
            flags,
            n_samples: n_samples as u32,
            interval_us,
        }
    }
}
