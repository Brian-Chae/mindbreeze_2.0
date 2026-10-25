//! EEGSignalProcessor.ts 포팅 (v1 profile): 60Hz notch → 1~45Hz bandpass → 15% transient 제거
//! → SQI → Morlet(7 cycles) PSD(PSD_CALIB × corr(f)) → 밴드파워 → SQI 가중 기하평균 → raw indices.
//! 윈도 경계(최소 500 / 최대 1250 샘플 링)는 engine 이 보장한다.

use super::biquad::Biquad;
use super::math::*;
use serde::{Deserialize, Serialize};

pub const FS: f64 = 250.0;
const N_CYCLES: f64 = 7.0;
const EPS: f64 = 1e-10;
const MAX_ANALYSIS_SAMPLES: usize = 1000;
const PSD_CALIB: f64 = 0.00739181390669613;
const QUALITY_THRESHOLD: f64 = 15.0;

/// 1~45Hz 보정 vector (haru 정본)
const PSD_CORR: [f64; 45] = [
    3.458011, 0.954247, 0.979583, 1.014871, 0.991486, 0.985819, 0.988772, 0.983593, 1.000722, 1.019498, 1.015089, 1.002732,
    0.994022, 0.986332, 0.979657, 0.976007, 0.976767, 0.981398, 0.987247, 0.99246, 0.996599, 0.999288, 1.000258, 1.000149,
    1.000518, 1.002928, 1.008112, 1.016309, 1.027692, 1.042752, 1.062329, 1.087514, 1.119614, 1.160231, 1.21135, 1.275479,
    1.355671, 1.455584, 1.579855, 1.733971, 1.924999, 2.161598, 2.454839, 2.818886, 3.271393,
];

fn corr(freq: f64) -> f64 {
    let hz = js_round(freq).clamp(1.0, 45.0) as usize;
    PSD_CORR[hz - 1]
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct EegPoint {
    pub ts: f64,
    pub fp1: f64,
    pub fp2: f64,
    pub lo1: bool,
    pub lo2: bool,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Bands {
    pub delta: f64,
    pub theta: f64,
    pub alpha: f64,
    pub beta: f64,
    pub gamma: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Indices {
    pub focus_index: f64,
    pub relaxation_index: f64,
    pub stress_index: f64,
    pub hemispheric_balance: f64,
    pub cognitive_load: f64,
    pub emotional_stability: f64,
    pub total_neural_activity: f64,
    pub faa: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Spectrum {
    pub frequencies: Vec<f64>,
    pub ch1_power: Vec<f64>,
    pub ch2_power: Vec<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EegResult {
    pub sqi_overall_pct: f64,
    pub sqi_fp1_pct: f64,
    pub sqi_fp2_pct: f64,
    /// 샘플별 (ch1+ch2)/2 SQI(%). transient 제거 뒤 구간.
    pub sqi_series: Vec<f64>,
    pub filtered_len: usize,
    pub bands: Bands,
    pub indices: Indices,
    pub spectrum: Option<Spectrum>,
    pub window_len: usize,
}

fn amplitude_sqi(data: &[f64]) -> Vec<f64> {
    let n = data.len();
    let mut sqi = vec![0.0; n];
    if n == 0 {
        return sqi;
    }
    let wl = 125usize.min(n);
    let last_start = n - wl;
    for i in 0..=last_start {
        let mut sum = 0.0;
        for &s in &data[i..i + wl] {
            let a = s.abs();
            let q = if a <= 150.0 {
                1.0
            } else {
                let red = ((a - 150.0) / 150.0).min(1.0);
                (1.0 - red).max(0.0)
            };
            sum += q;
        }
        let score = sum / wl as f64;
        for v in &mut sqi[i..i + wl] {
            *v = score;
        }
    }
    sqi
}

fn frequency_sqi(data: &[f64]) -> Vec<f64> {
    let n = data.len();
    let mut sqi = vec![0.0; n];
    if n == 0 {
        return sqi;
    }
    let wl = 125usize.min(n);
    let last_start = n - wl;
    for i in 0..=last_start {
        let var = variance(&data[i..i + wl]);
        let score = (1.0 - var / 1000.0).clamp(0.0, 1.0);
        for v in &mut sqi[i..i + wl] {
            *v = score;
        }
    }
    sqi
}

fn morlet_power(data: &[f64], freq: f64) -> f64 {
    let target = js_round(N_CYCLES * FS / freq) as usize;
    let l = target.min(data.len()).min(MAX_ANALYSIS_SAMPLES);
    if l < 2 {
        return 0.0;
    }
    let cycles = (l as f64 * freq) / FS;
    let sigma_t = cycles / (2.0 * std::f64::consts::PI * freq);
    let center = (l as f64 - 1.0) / 2.0;
    let norm = pow(std::f64::consts::PI, -0.25) * sqrt(1.0 / sigma_t) / sqrt(FS);
    let mut wr = Vec::with_capacity(l);
    let mut wi = Vec::with_capacity(l);
    for i in 0..l {
        let t = (i as f64 - center) / FS;
        let gauss = exp(-(t * t) / (2.0 * sigma_t * sigma_t));
        let omega = 2.0 * std::f64::consts::PI * freq * t;
        wr.push(norm * gauss * cos(omega));
        wi.push(norm * gauss * sin(omega));
    }
    let res_len = if data.len() >= l { (data.len() - l + 1).max(1) } else { 1 };
    let mut total = 0.0;
    for i in 0..res_len {
        let mut rs = 0.0;
        let mut is = 0.0;
        for j in 0..l {
            let sv = data[i + j];
            rs += sv * wr[j];
            is += sv * wi[j];
        }
        total += rs * rs + is * is;
    }
    let raw = total / res_len as f64;
    PSD_CALIB * corr(freq) * raw
}

fn spectrum(data: &[f64], freqs: &[f64]) -> Vec<f64> {
    if data.len() < 125 {
        return vec![0.0; freqs.len()];
    }
    freqs.iter().map(|&f| morlet_power(data, f)).collect()
}

fn band_powers(power: &[f64], freqs: &[f64]) -> Bands {
    let mut b = Bands::default();
    if power.is_empty() || freqs.is_empty() {
        return b;
    }
    for (i, &f) in freqs.iter().enumerate() {
        let p = power[i];
        if (1.0..4.0).contains(&f) {
            b.delta += p;
        } else if (4.0..8.0).contains(&f) {
            b.theta += p;
        } else if (8.0..13.0).contains(&f) {
            b.alpha += p;
        } else if (13.0..30.0).contains(&f) {
            b.beta += p;
        } else if (30.0..45.0).contains(&f) {
            b.gamma += p; // 45Hz bin 은 gamma(<45) 에서 제외 — TS 동작 그대로
        }
    }
    b
}

fn merge_one(p1: f64, p2: f64, w1: f64, w2: f64, total_w: f64) -> f64 {
    if w1 <= 0.0 && w2 <= 0.0 {
        return 0.0;
    }
    if w1 <= 0.0 {
        return p2;
    }
    if w2 <= 0.0 {
        return p1;
    }
    if p1 <= 0.0 && p2 <= 0.0 {
        return 0.0;
    }
    if p1 <= 0.0 {
        return p2;
    }
    if p2 <= 0.0 {
        return p1;
    }
    exp((w1 * log(p1) + w2 * log(p2)) / total_w)
}

fn merge(c1: &Bands, c2: &Bands, w1: f64, w2: f64) -> Bands {
    let tw = w1 + w2;
    if tw <= 0.0 {
        return Bands::default();
    }
    Bands {
        delta: merge_one(c1.delta, c2.delta, w1, w2, tw),
        theta: merge_one(c1.theta, c2.theta, w1, w2, tw),
        alpha: merge_one(c1.alpha, c2.alpha, w1, w2, tw),
        beta: merge_one(c1.beta, c2.beta, w1, w2, tw),
        gamma: merge_one(c1.gamma, c2.gamma, w1, w2, tw),
    }
}

/// JS `x || 0` — NaN/0 → 0
fn or0(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 {
        0.0
    } else {
        x
    }
}

fn raw_indices(m: &Bands, c1: &Bands, c2: &Bands, v1: bool, v2: bool) -> Indices {
    let (alpha, beta, theta, gamma) = (m.alpha, m.beta, m.theta, m.gamma);
    let ch1_total = c1.delta + c1.theta + c1.alpha + c1.beta + c1.gamma;
    let ch2_total = c2.delta + c2.theta + c2.alpha + c2.beta + c2.gamma;
    let faa = if v1 && v2 && c1.alpha > 0.0 && c2.alpha > 0.0 { Some(log(c2.alpha) - log(c1.alpha)) } else { None };
    let alpha_sum = c1.alpha + c2.alpha;
    let hb = if alpha_sum > EPS { (c1.alpha - c2.alpha) / alpha_sum } else { 0.0 };
    Indices {
        focus_index: or0(beta / (alpha + theta + EPS)),
        relaxation_index: or0(alpha / (alpha + beta + EPS)),
        stress_index: or0((beta + gamma) / (alpha + theta + EPS)),
        cognitive_load: or0(theta / (alpha + EPS)),
        emotional_stability: or0((alpha + theta) / (gamma + EPS)),
        total_neural_activity: or0((ch1_total + ch2_total) / 2.0),
        faa,
        hemispheric_balance: or0(hb.clamp(-1.0, 1.0)),
    }
}

/// 윈도 1개 분석. `data.len() >= 500` 는 호출자 책임(TS 는 미만이면 throw).
pub fn analyze(data: &[EegPoint], emit_spectrum: bool) -> Option<EegResult> {
    if data.len() < 500 {
        return None;
    }
    let ch1: Vec<f64> = data.iter().map(|p| p.fp1).collect();
    let ch2: Vec<f64> = data.iter().map(|p| p.fp2).collect();
    let filt = |x: &[f64]| -> Vec<f64> {
        let n = Biquad::notch(60.0, FS, 2.0).run(x);
        Biquad::bandpass(1.0, 45.0, FS).run(&n)
    };
    let f1 = filt(&ch1);
    let f2 = filt(&ch2);
    let transient = (data.len() as f64 * 0.15).floor() as usize;
    let c1: &[f64] = if f1.len() > transient { &f1[transient..] } else { &f1 };
    let c2: &[f64] = if f2.len() > transient { &f2[transient..] } else { &f2 };

    let comb = |c: &[f64]| -> Vec<f64> {
        let a = amplitude_sqi(c);
        let f = frequency_sqi(c);
        a.iter().zip(&f).map(|(a, f)| (0.7 * a + 0.3 * f) * 100.0).collect()
    };
    let s1 = comb(c1);
    let s2 = comb(c2);
    let m1: Vec<bool> = s1.iter().map(|&s| s >= QUALITY_THRESHOLD).collect();
    let m2: Vec<bool> = s2.iter().map(|&s| s >= QUALITY_THRESHOLD).collect();
    let good = m1.iter().zip(&m2).filter(|(a, b)| **a && **b).count();
    let avg1 = sum(&s1) / s1.len() as f64;
    let avg2 = sum(&s2) / s2.len() as f64;

    let (d1, d2): (Vec<f64>, Vec<f64>) = if good > 100 {
        let q1: Vec<f64> = c1.iter().zip(&m1).filter(|(_, m)| **m).map(|(v, _)| *v).collect();
        let q2: Vec<f64> = c2.iter().zip(&m2).filter(|(_, m)| **m).map(|(v, _)| *v).collect();
        let l = q1.len().min(q2.len());
        (q1[..l].to_vec(), q2[..l].to_vec())
    } else {
        (c1.to_vec(), c2.to_vec())
    };

    let mut freqs: Vec<f64> = Vec::new();
    let mut p1: Vec<f64> = Vec::new();
    let mut p2: Vec<f64> = Vec::new();
    if d1.len() >= 125 {
        freqs = (1..=45).map(|i| i as f64).collect();
        p1 = spectrum(&d1, &freqs);
        p2 = spectrum(&d2, &freqs);
    }
    let b1 = band_powers(&p1, &freqs);
    let b2 = band_powers(&p2, &freqs);
    let merged = merge(&b1, &b2, avg1 / 100.0, avg2 / 100.0);
    let indices = raw_indices(&merged, &b1, &b2, avg1 >= QUALITY_THRESHOLD, avg2 >= QUALITY_THRESHOLD);
    let sqi_series: Vec<f64> = s1.iter().zip(&s2).map(|(a, b)| (a + b) / 2.0).collect();
    Some(EegResult {
        sqi_overall_pct: (good as f64 / c1.len() as f64) * 100.0,
        sqi_fp1_pct: avg1,
        sqi_fp2_pct: avg2,
        sqi_series,
        filtered_len: c1.len(),
        bands: merged,
        indices,
        spectrum: if emit_spectrum { Some(Spectrum { frequencies: freqs, ch1_power: p1, ch2_power: p2 }) } else { None },
        window_len: data.len(),
    })
}
