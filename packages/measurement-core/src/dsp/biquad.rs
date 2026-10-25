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
