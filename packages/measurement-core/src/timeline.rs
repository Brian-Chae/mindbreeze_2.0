//! 현 웹(TimestampSynchronizer.ts + blePacketParser.ts) 샘플 시각 타임라인 — v1 profile 보존용 포팅.
//! 센서별 독립: 첫 패킷 도착 벽시계(ms)에 앵커, 5초마다 ±2ms slew, 1초 이상 어긋나면 하드 재앵커.
//! ACC 는 패킷 간 연속성(직전 샘플 + N×33.333ms)과 33.33ms 격자 스냅을 그대로 따른다.
use crate::parser::Sensor;
use serde::{Deserialize, Serialize};

const SYNC_INTERVAL: f64 = 5000.0;
const MAX_SLEW: f64 = 2.0;
const HARD_RESYNC: f64 = 1000.0;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct WClock {
    master_base: f64,
    dev_base: f64,
    last_dev: f64,
    slew: f64,
    window_min: f64,
    last_sync: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WebTimeline {
    sensor: Sensor,
    expected: f64,
    clock: Option<WClock>,
    last_sample: Option<f64>,
    actual_interval: f64,
    last_acc: f64,
}

fn js_round(x: f64) -> f64 {
    crate::dsp::math::js_round(x)
}

impl WebTimeline {
    pub fn new(sensor: Sensor) -> Self {
        let expected = match sensor {
            Sensor::Eeg => 4.0,
            Sensor::Ppg => 20.0,
            Sensor::Acc => 33.33,
        };
        WebTimeline { sensor, expected, clock: None, last_sample: None, actual_interval: expected, last_acc: 0.0 }
    }

    /// 장치 시각(ms) → 웹 타임라인 시각(ms). `now_ms` = Date.now().
    fn normalize(&mut self, dev: f64, now: f64) -> f64 {
        if self.clock.is_none() {
            self.clock = Some(WClock { master_base: now, dev_base: dev, last_dev: dev, slew: 0.0, window_min: f64::INFINITY, last_sync: now });
        }
        let c = self.clock.unwrap();
        let normalized = c.master_base + (dev - c.dev_base) + c.slew;
        let mut corrected = normalized;
        let diff = (self.actual_interval - self.expected).abs();
        if diff > 10.0 && self.sensor == Sensor::Acc && diff > self.expected * 0.5 {
            if let Some(last) = self.last_sample {
                if last > 0.0 {
                    let steps = js_round((normalized - last) / self.expected);
                    corrected = last + steps * self.expected;
                }
            }
        }
        // updateSensorTiming
        let last_t = self.last_sample.unwrap_or(0.0);
        if last_t > 0.0 {
            self.actual_interval = (1.0 - 0.1) * self.actual_interval + 0.1 * (normalized - last_t);
        }
        self.last_sample = Some(normalized);
        let c = self.clock.as_mut().unwrap();
        c.window_min = c.window_min.min(now - dev);
        c.last_dev = dev;
        if now - c.last_sync >= SYNC_INTERVAL {
            self.resync(now);
        }
        corrected
    }

    fn resync(&mut self, now: f64) {
        let c = self.clock.as_mut().unwrap();
        c.last_sync = now;
        if !c.window_min.is_finite() {
            return;
        }
        let current = c.master_base - c.dev_base + c.slew;
        let delta = c.window_min - current;
        c.window_min = f64::INFINITY;
        if delta.abs() > HARD_RESYNC {
            c.master_base = now;
            c.dev_base = c.last_dev;
            c.slew = 0.0;
            self.last_sample = None;
            return;
        }
        let step = delta.clamp(-MAX_SLEW, MAX_SLEW);
        c.slew += step;
        if let Some(l) = self.last_sample {
            self.last_sample = Some(l + step);
        }
    }

    /// 패킷 하나의 샘플 시각(ms) n개. 헤더는 마지막 샘플 기준(v1).
    pub fn sample_times(&mut self, ext_tick: i64, n: usize, now_ms: f64) -> Vec<f64> {
        let dev = (ext_tick as f64 / 32768.0) * 1000.0;
        let corrected = self.normalize(dev, now_ms);
        match self.sensor {
            Sensor::Eeg | Sensor::Ppg => {
                let iv = if self.sensor == Sensor::Eeg { 4.0 } else { 20.0 };
                (0..n).map(|i| corrected + (i as f64 - n as f64 + 1.0) * iv).collect()
            }
            Sensor::Acc => {
                let iv = 33.333;
                let mut base;
                if self.last_acc == 0.0 {
                    base = corrected;
                } else {
                    base = self.last_acc + n as f64 * iv;
                    let since = corrected - self.last_acc;
                    let expected = n as f64 * iv;
                    if since > expected * 3.0 {
                        base = corrected;
                    }
                }
                let v: Vec<f64> = (0..n).map(|i| base + (i as f64 - n as f64 + 1.0) * iv).collect();
                if let Some(l) = v.last() {
                    self.last_acc = *l;
                }
                v
            }
        }
    }
}
