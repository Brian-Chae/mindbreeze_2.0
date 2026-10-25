//! biquadjs 1.1.0 (BiquadFilters.js) 의 notch/bandpass 계수와 직접형 I 구조를 그대로 옮김.
use super::math::{cos, log10, pow, sin, sqrt};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

#[derive(Clone, Copy)]
enum Kind {
    Notch,
    Bandpass,
}

fn build(kind: Kind, freq: f64, sps: f64, q: f64) -> Biquad {
    let omega = 2.0 * std::f64::consts::PI * freq / sps;
    let sn = sin(omega);
    let cs = cos(omega);
    let alpha = sn / (2.0 * q);
    let (mut b0, mut b1, mut b2, a0, mut a1, mut a2);
    match kind {
        Kind::Notch => {
            b0 = 1.0;
            b1 = -2.0 * cs;
            b2 = 1.0;
            a0 = 1.0 + alpha;
            a1 = -2.0 * cs;
            a2 = 1.0 - alpha;
        }
        Kind::Bandpass => {
            b0 = alpha;
            b1 = 0.0;
            b2 = -alpha;
            a0 = 1.0 + alpha;
            a1 = -2.0 * cs;
            a2 = 1.0 - alpha;
        }
    }
    b0 /= a0;
    b1 /= a0;
    b2 /= a0;
    a1 /= a0;
    a2 /= a0;
    Biquad { b0, b1, b2, a1, a2, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
}

impl Biquad {
    /// makeNotchFilter(freq, sps, bandwidth)
    pub fn notch(freq: f64, sps: f64, bandwidth: f64) -> Biquad {
        let resonance = pow(10.0, libm::floor(log10(freq)));
        let q = resonance * freq * bandwidth / sqrt((freq - bandwidth) * (freq + bandwidth));
        build(Kind::Notch, freq, sps, q)
    }
    /// makeBandpassFilter(freqStart, freqEnd, sps) — resonance 기본값 사용.
    pub fn bandpass(freq_start: f64, freq_end: f64, sps: f64) -> Biquad {
        let center = (freq_start + freq_end) / 2.0;
        let bandwidth = freq_end - center;
        let resonance = pow(10.0, libm::floor(log10(center)));
        let q = resonance * sqrt((center - bandwidth) * (center + bandwidth)) / (2.0 * bandwidth);
        build(Kind::Bandpass, center, sps, q)
    }
    pub fn apply(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
    pub fn run(mut self, data: &[f64]) -> Vec<f64> {
        data.iter().map(|&v| self.apply(v)).collect()
    }
}

/// 필터 구현 선택. `Biquad` = 브라우저 번들(biquadjs ESM)의 실제 동작(제품 기본).
/// `LegacyFallback` = TS 의 `fallback*Filter`. vitest/node 에서는 biquadjs 의 named export 가 해석되지 않아
/// (패키지 main 이 export 없는 IIFE) TS 가 항상 fallback 으로 떨어진다 → T01 oracle expected 가 이 경로로 생성됨.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterImpl {
    Biquad,
    LegacyFallback,
}

use super::math::exp;

pub fn eeg_notch(data: &[f64], imp: FilterImpl) -> Vec<f64> {
    match imp {
        FilterImpl::Biquad => Biquad::notch(60.0, 250.0, 2.0).run(data),
        FilterImpl::LegacyFallback => {
            let omega = 2.0 * std::f64::consts::PI * 60.0 / 250.0;
            let alpha = 0.95;
            let (b0, b1, b2) = (1.0, -2.0 * cos(omega), 1.0);
            let (a0, a1, a2) = (1.0 + alpha, -2.0 * cos(omega), alpha);
            let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
            data.iter()
                .map(|&x0| {
                    let y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
                    x2 = x1;
                    x1 = x0;
                    y2 = y1;
                    y1 = y0;
                    y0
                })
                .collect()
        }
    }
}

pub fn eeg_bandpass(data: &[f64], imp: FilterImpl) -> Vec<f64> {
    match imp {
        FilterImpl::Biquad => Biquad::bandpass(1.0, 45.0, 250.0).run(data),
        FilterImpl::LegacyFallback => {
            if data.is_empty() {
                return vec![];
            }
            let nyq = 250.0 / 2.0;
            let a_hp = exp(-2.0 * std::f64::consts::PI * (1.0 / nyq));
            let mut hp = vec![0.0; data.len()];
            hp[0] = data[0];
            for i in 1..data.len() {
                hp[i] = a_hp * (hp[i - 1] + data[i] - data[i - 1]);
            }
            let a_lp = exp(-2.0 * std::f64::consts::PI * (45.0 / nyq));
            let mut lp = vec![0.0; hp.len()];
            lp[0] = hp[0];
            for i in 1..hp.len() {
                lp[i] = a_lp * lp[i - 1] + (1.0 - a_lp) * hp[i];
            }
            lp
        }
    }
}

/// PPG: DC 제거 후 1~5Hz bandpass (또는 fallback: 길이 3 이동평균)
pub fn ppg_filter(data: &[f64], imp: FilterImpl) -> Vec<f64> {
    let mean = super::math::sum(data) / data.len() as f64;
    let dc: Vec<f64> = data.iter().map(|&v| v - mean).collect();
    match imp {
        FilterImpl::Biquad => Biquad::bandpass(1.0, 5.0, 50.0).run(&dc),
        FilterImpl::LegacyFallback => (0..dc.len())
            .map(|i| {
                let start = i.saturating_sub(1);
                let end = (dc.len()).min(i + 2);
                let mut s = 0.0;
                for j in start..end {
                    s += dc[j];
                }
                s / (end - start) as f64
            })
            .collect(),
    }
}
