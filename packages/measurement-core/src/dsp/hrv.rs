//! AnalysisMetricsService.ts 의 HRV/호흡 상태기계 포팅 (v1).
//! gate·null 규칙 보존: SDNN/RMSSD 는 최근 60RR, 내부 ≥10개·합 ≥30초, 외부 RR 버퍼 ≥30 필요.
//! 호흡: RR 합 ≥60초 && 실제 경과(첫~끝 박동 시각) ≥60초, 4Hz 재샘플, Welch 0.15~0.4Hz, 중앙값 5.
//! "60초면 반드시 값"이라고 가정하지 않는다 — 산출 불가는 null + 사유 코드(0 치환 금지).

use super::math::*;
use serde::{Deserialize, Serialize};

pub use super::math::js_round;

const LF_HF_BUFFER_SIZE: usize = 120;
const LF_HF_INTERVAL_MS: f64 = 1000.0;
const TIME_DOMAIN_WINDOW_RR: usize = 60;
const RESP_MIN_WINDOW_MS: f64 = 60000.0;
const RESP_MEDIAN_WINDOW: usize = 5;
const EMA_HR: f64 = 0.3;
const EMA_FREQ: f64 = 0.3;
const RR_CLOCK_RESET_MS: f64 = 5000.0;
const MAX_HISTORY: usize = 120;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct HrvSnapshot {
    pub sdnn: Option<f64>,
    pub rmssd: Option<f64>,
    pub pnn50: Option<f64>,
    pub lf_power: Option<f64>,
    pub hf_power: Option<f64>,
    pub lf_hf_ratio: Option<f64>,
    pub stress_index: Option<f64>,
    pub avnn: Option<f64>,
    pub pnn20: Option<f64>,
    pub sdsd: Option<f64>,
    pub hr_max: Option<f64>,
    pub hr_min: Option<f64>,
    pub heart_rate: Option<f64>,
    pub motion: Option<f64>,
    pub respiratory_rate: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HrvState {
    bpm_buffer: Vec<f64>,
    rr: Vec<f64>,
    rr_ts: Vec<f64>,
    last_rr_end_ts: f64,
    last_lfhf_calc: f64,
    lf: f64,
    hf: f64,
    lfhf: f64,
    rmssd: f64,
    sdnn: f64,
    sdsd: f64,
    avnn: f64,
    pnn50: f64,
    pnn20: f64,
    stress: f64,
    hr_max: f64,
    hr_min: f64,
    heart_rate: Option<f64>,
    motion: Option<f64>,
    resp: Option<f64>,
    smoothed_hr: Option<f64>,
    resp_history: Vec<f64>,
    resp_null_reason: Option<String>,
    has_time: bool,
    has_freq: bool,
    has_hr_stats: bool,
}

impl Default for HrvState {
    fn default() -> Self {
        HrvState {
            bpm_buffer: vec![],
            rr: vec![],
            rr_ts: vec![],
            last_rr_end_ts: f64::NEG_INFINITY,
            last_lfhf_calc: 0.0,
            lf: 0.0,
            hf: 0.0,
            lfhf: 0.0,
            rmssd: 0.0,
            sdnn: 0.0,
            sdsd: 0.0,
            avnn: 0.0,
            pnn50: 0.0,
            pnn20: 0.0,
            stress: 0.0,
            hr_max: 0.0,
            hr_min: 0.0,
            heart_rate: None,
            motion: None,
            resp: None,
            smoothed_hr: None,
            resp_history: vec![],
            resp_null_reason: Some("no_ppg_data".into()),
            has_time: false,
            has_freq: false,
            has_hr_stats: false,
        }
    }
}

fn median_of(v: &[f64]) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mid = s.len() / 2;
    if s.len() % 2 != 0 {
        s[mid]
    } else {
        (s[mid - 1] + s[mid]) / 2.0
    }
}

fn smooth_freq(value: f64, current: f64) -> f64 {
    if current <= 0.0 || !current.is_finite() {
        return value;
    }
    current * (1.0 - EMA_FREQ) + value * EMA_FREQ
}

fn valid_value(value: f64, prev: f64, min: f64) -> f64 {
    if value > min && !value.is_nan() && value.is_finite() {
        value
    } else {
        prev
    }
}

fn interpolate_linear(xo: &[f64], yo: &[f64], xn: &[f64]) -> Vec<f64> {
    let mut out = Vec::with_capacity(xn.len());
    for &x in xn {
        if x <= xo[0] {
            out.push(yo[0]);
        } else if x >= xo[xo.len() - 1] {
            out.push(yo[yo.len() - 1]);
        } else {
            let mut i = 0;
            while i < xo.len() - 1 && xo[i + 1] < x {
                i += 1;
            }
            let (x1, x2, y1, y2) = (xo[i], xo[i + 1], yo[i], yo[i + 1]);
            out.push(y1 + ((y2 - y1) * (x - x1)) / (x2 - x1));
        }
    }
    out
}

fn resample(rr: &[f64], fs: f64) -> Vec<f64> {
    if rr.len() < 2 {
        return vec![];
    }
    let secs: Vec<f64> = rr.iter().map(|&r| r / 1000.0).collect();
    let mut t = vec![0.0];
    for &s in &secs {
        let last = t[t.len() - 1];
        t.push(last + s);
    }
    let total = t[t.len() - 1];
    let n = (total * fs).floor();
    if n < 4.0 {
        return vec![];
    }
    let xn: Vec<f64> = (0..n as usize).map(|i| i as f64 / fs).collect();
    interpolate_linear(&t, &secs, &xn)
}

fn hamming(size: usize) -> Vec<f64> {
    (0..size).map(|i| 0.54 - 0.46 * cos((2.0 * std::f64::consts::PI * i as f64) / (size as f64 - 1.0))).collect()
}

fn next_pow2(n: usize) -> usize {
    let mut p = 1;
    while p < n {
        p *= 2;
    }
    p
}

fn fft(data: &[f64]) -> Vec<f64> {
    let n = data.len();
    let mut c = vec![0.0; n * 2];
    for i in 0..n {
        c[2 * i] = data[i];
    }
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            c.swap(2 * i, 2 * j);
            c.swap(2 * i + 1, 2 * j + 1);
        }
    }
    let mut length = 2;
    while length <= n {
        let angle = (-2.0 * std::f64::consts::PI) / length as f64;
        let wreal = cos(angle);
        let wimag = sin(angle);
        let mut i = 0;
        while i < n {
            let mut wr = 1.0;
            let mut wi = 0.0;
            for jj in 0..length / 2 {
                let (a, b) = (2 * (i + jj), 2 * (i + jj + length / 2));
                let (ur, ui) = (c[a], c[a + 1]);
                let vr = c[b] * wr - c[b + 1] * wi;
                let vi = c[b] * wi + c[b + 1] * wr;
                c[a] = ur + vr;
                c[a + 1] = ui + vi;
                c[b] = ur - vr;
                c[b + 1] = ui - vi;
                let t = wr * wreal - wi * wimag;
                wi = wr * wimag + wi * wreal;
                wr = t;
            }
            i += length;
        }
        length *= 2;
    }
    c
}

fn welch(data: &[f64], fs: f64) -> (Vec<f64>, Vec<f64>) {
    let window = 64usize.max(256usize.min(data.len() / 2));
    let overlap = window / 2;
    let nfft = next_pow2(window);
    let freqs: Vec<f64> = (0..=nfft / 2).map(|i| (i as f64 * fs) / nfft as f64).collect();
    let ham = hamming(window);
    let mut spectra: Vec<Vec<f64>> = vec![];
    let mut start = 0usize;
    while start + window <= data.len() {
        let mut padded = vec![0.0; nfft];
        for i in 0..window {
            padded[i] = data[start + i] * ham[i];
        }
        let f = fft(&padded);
        let mut wp = 0.0;
        for &w in &ham {
            wp += w * w;
        }
        let mut ps = Vec::with_capacity(nfft / 2 + 1);
        for i in 0..=nfft / 2 {
            let re = f[2 * i];
            let im = f[2 * i + 1];
            let mut p = (re * re + im * im) / (fs * wp);
            if i > 0 && i < nfft / 2 {
                p *= 2.0;
            }
            ps.push(p);
        }
        spectra.push(ps);
        start += window - overlap;
    }
    let mut psd = vec![0.0; freqs.len()];
    for s in &spectra {
        for i in 0..s.len() {
            psd[i] += s[i];
        }
    }
    let n = spectra.len() as f64;
    for v in &mut psd {
        *v /= n; // 0/0 → NaN (TS 동일)
    }
    (freqs, psd)
}

fn integrate(freqs: &[f64], psd: &[f64], lo: f64, hi: f64) -> f64 {
    let mut power = 0.0;
    for i in 0..freqs.len() - 1 {
        let (f, nf) = (freqs[i], freqs[i + 1]);
        if f >= lo && nf <= hi {
            power += ((psd[i] + psd[i + 1]) / 2.0) * (nf - f);
        } else if f < lo && nf > lo && nf <= hi {
            let ip = psd[i] + ((psd[i + 1] - psd[i]) * (lo - f)) / (nf - f);
            power += ((ip + psd[i + 1]) / 2.0) * (nf - lo);
        } else if f >= lo && f < hi && nf > hi {
            let ip = psd[i] + ((psd[i + 1] - psd[i]) * (hi - f)) / (nf - f);
            power += ((psd[i] + ip) / 2.0) * (hi - f);
        }
    }
    power
}

impl HrvState {
    pub fn set_motion(&mut self, m: Option<f64>) {
        self.motion = m;
    }
    pub fn motion(&self) -> Option<f64> {
        self.motion
    }
    pub fn rr_buffer_len(&self) -> usize {
        self.rr.len()
    }
    pub fn resp_null_reason(&self) -> Option<&str> {
        if self.resp.is_none() {
            self.resp_null_reason.as_deref()
        } else {
            None
        }
    }

    pub fn snapshot(&self) -> HrvSnapshot {
        let t = |v: f64, ok: bool| if ok { Some(v) } else { None };
        HrvSnapshot {
            sdnn: t(self.sdnn, self.has_time),
            rmssd: t(self.rmssd, self.has_time),
            pnn50: t(self.pnn50, self.has_time),
            lf_power: t(self.lf, self.has_freq),
            hf_power: t(self.hf, self.has_freq),
            lf_hf_ratio: t(self.lfhf, self.has_freq),
            stress_index: t(self.stress, self.has_time),
            avnn: t(self.avnn, self.has_time),
            pnn20: t(self.pnn20, self.has_time),
            sdsd: t(self.sdsd, self.has_time),
            hr_max: t(self.hr_max, self.has_hr_stats),
            hr_min: t(self.hr_min, self.has_hr_stats),
            heart_rate: self.heart_rate,
            motion: self.motion,
            respiratory_rate: self.resp,
        }
    }

    /// processPPGAnalysisMetrics: `now_ms` = Date.now() (벽시계 ms 정수)
    pub fn process_ppg(&mut self, heart_rate_raw: f64, rr: &[f64], rr_end_ts: &[f64], now_ms: f64) {
        if heart_rate_raw > 40.0 && heart_rate_raw < 200.0 {
            self.update_heart_rate(heart_rate_raw);
        }
        if !rr.is_empty() {
            self.update_rr_buffer(rr, rr_end_ts, now_ms);
            self.calc_lfhf(now_ms);
        }
    }

    fn update_heart_rate(&mut self, hr: f64) {
        self.smoothed_hr = Some(match self.smoothed_hr {
            None => hr,
            Some(s) => s * (1.0 - EMA_HR) + hr * EMA_HR,
        });
        let cur = js_round(self.smoothed_hr.unwrap());
        self.heart_rate = Some(cur);
        if cur > 40.0 && cur < 200.0 {
            self.bpm_buffer.push(cur);
            if self.bpm_buffer.len() > MAX_HISTORY {
                self.bpm_buffer.remove(0);
            }
        }
    }

    fn update_rr_buffer(&mut self, rr: &[f64], ts: &[f64], now_ms: f64) {
        let stamped = ts.len() == rr.len() && ts.iter().all(|t| t.is_finite());
        let mut cand: Vec<(f64, f64)> = rr.iter().enumerate().map(|(i, &r)| (r, if stamped { ts[i] } else { f64::NAN })).collect();
        if stamped {
            let mut newest = f64::NEG_INFINITY;
            for c in &cand {
                if c.1.is_finite() && c.1 > newest {
                    newest = c.1;
                }
            }
            if newest.is_finite() && newest < self.last_rr_end_ts - RR_CLOCK_RESET_MS {
                self.last_rr_end_ts = f64::NEG_INFINITY;
                self.rr.clear();
                self.rr_ts.clear();
                self.bpm_buffer.clear();
                self.resp_history.clear();
                self.resp = None;
                self.resp_null_reason = Some("insufficient_window".into());
                self.last_lfhf_calc = 0.0;
                self.smoothed_hr = None;
                self.lf = 0.0;
                self.hf = 0.0;
                self.lfhf = 0.0;
            }
            let future = now_ms + RR_CLOCK_RESET_MS;
            if self.last_rr_end_ts > future {
                self.last_rr_end_ts = f64::NEG_INFINITY;
                self.rr.clear();
                self.rr_ts.clear();
            }
            cand.retain(|c| c.1.is_finite() && c.1 <= future);
            let last = self.last_rr_end_ts;
            cand.retain(|c| c.1.is_finite() && c.1 > last);
        }
        let valid: Vec<(f64, f64)> = cand.into_iter().filter(|c| c.0 >= 200.0 && c.0 <= 2000.0).collect();
        if valid.is_empty() {
            return;
        }
        for c in &valid {
            self.rr.push(c.0);
            self.rr_ts.push(c.1);
        }
        if stamped {
            for c in &valid {
                if c.1 > self.last_rr_end_ts {
                    self.last_rr_end_ts = c.1;
                }
            }
        }
        if self.rr.len() > LF_HF_BUFFER_SIZE {
            let cut = self.rr.len() - LF_HF_BUFFER_SIZE;
            self.rr.drain(..cut);
            self.rr_ts.drain(..cut);
        }
    }

    fn calc_lfhf(&mut self, now_ms: f64) {
        if self.rr.len() < 30 {
            if self.resp.is_none() {
                self.resp_null_reason = Some("insufficient_rr_buffer".into());
            }
            return;
        }
        if now_ms - self.last_lfhf_calc < LF_HF_INTERVAL_MS {
            return;
        }
        let rr = self.rr.clone();
        self.time_domain(&rr);
        self.stress_metrics(&rr);
        self.hr_stats();
        self.freq_domain(&rr);
        self.respiratory(&rr);
        self.last_lfhf_calc = now_ms;
    }

    fn respiratory(&mut self, rr: &[f64]) {
        let total = sum(rr);
        let stamps: Vec<f64> = self.rr_ts.iter().cloned().filter(|t| t.is_finite()).collect();
        let elapsed = if stamps.len() >= 2 { stamps[stamps.len() - 1] - stamps[0] } else { f64::INFINITY };
        let fail = |s: &mut HrvState, why: &str| {
            s.resp = None;
            s.resp_null_reason = Some(why.into());
            s.resp_history.clear();
        };
        if total < RESP_MIN_WINDOW_MS || elapsed < RESP_MIN_WINDOW_MS {
            return fail(self, "insufficient_window");
        }
        let fs = 4.0;
        let rs = resample(rr, fs);
        if rs.len() < 16 {
            return fail(self, "insufficient_resampled_points");
        }
        let (freqs, psd) = welch(&rs, fs);
        let mut max_p = f64::NEG_INFINITY;
        let mut dom: Option<f64> = None;
        for i in 0..freqs.len() {
            let f = freqs[i];
            if f < 0.15 || f > 0.4 {
                continue;
            }
            if psd[i] > max_p {
                max_p = psd[i];
                dom = Some(f);
            }
        }
        let Some(df) = dom.filter(|d| d.is_finite() && max_p > 0.0) else {
            return fail(self, "no_dominant_frequency");
        };
        let rate = df * 60.0;
        if rate < 6.0 || rate > 40.0 || !rate.is_finite() {
            return fail(self, "out_of_physiological_range");
        }
        self.resp_history.push(rate);
        if self.resp_history.len() > RESP_MEDIAN_WINDOW {
            self.resp_history.remove(0);
        }
        self.resp = Some(median_of(&self.resp_history));
        self.resp_null_reason = None;
    }

    fn time_domain(&mut self, all: &[f64]) {
        let rr: &[f64] = if all.len() > TIME_DOMAIN_WINDOW_RR { &all[all.len() - TIME_DOMAIN_WINDOW_RR..] } else { all };
        let total = sum(rr);
        if rr.len() < 10 || total < 30000.0 {
            self.has_time = false;
            return;
        }
        self.avnn = sum(rr) / rr.len() as f64;
        let mean = self.avnn;
        let mut v = 0.0;
        for &x in rr {
            let d = x - mean;
            v += d * d;
        }
        self.sdnn = sqrt(v / rr.len() as f64);
        let diffs: Vec<f64> = (1..rr.len()).map(|i| rr[i] - rr[i - 1]).collect();
        let mut sq = 0.0;
        for &d in &diffs {
            sq += d * d;
        }
        self.rmssd = sqrt(sq / diffs.len() as f64);
        let dm = sum(&diffs) / diffs.len() as f64;
        let mut dv = 0.0;
        for &d in &diffs {
            let e = d - dm;
            dv += e * e;
        }
        self.sdsd = sqrt(dv / diffs.len() as f64);
        let c50 = diffs.iter().filter(|d| d.abs() > 50.0).count() as f64;
        self.pnn50 = (c50 / (rr.len() as f64 - 1.0)) * 100.0;
        let c20 = diffs.iter().filter(|d| d.abs() > 20.0).count() as f64;
        self.pnn20 = (c20 / (rr.len() as f64 - 1.0)) * 100.0;
        self.has_time = true;
    }

    fn stress_metrics(&mut self, rr: &[f64]) {
        if rr.len() < 10 {
            self.stress = 0.0;
            return;
        }
        let ns = (0.0f64).max((1.0f64).min((100.0 - self.sdnn) / 70.0));
        let nr = (0.0f64).max((1.0f64).min((50.0 - self.rmssd) / 30.0));
        let avg_hr = 60000.0 / self.avnn;
        let hs = (0.0f64).max((1.0f64).min((avg_hr - 80.0).abs() / 40.0));
        self.stress = ns * 0.4 + nr * 0.4 + hs * 0.2;
        self.stress = (0.0f64).max((1.0f64).min(self.stress));
    }

    fn hr_stats(&mut self) {
        if self.bpm_buffer.is_empty() {
            self.hr_max = 0.0;
            self.hr_min = 0.0;
            self.has_hr_stats = false;
            return;
        }
        let v: Vec<f64> = self.bpm_buffer.iter().cloned().filter(|b| *b > 40.0 && *b < 200.0).collect();
        if !v.is_empty() {
            self.hr_max = max_of(&v);
            self.hr_min = min_of(&v);
            self.has_hr_stats = true;
        } else {
            self.hr_max = 0.0;
            self.hr_min = 0.0;
            self.has_hr_stats = false;
        }
    }

    fn freq_domain(&mut self, rr: &[f64]) {
        let valid: Vec<f64> = rr.iter().cloned().filter(|r| *r >= 300.0 && *r <= 2000.0).collect();
        if (valid.len() as f64 / rr.len() as f64) < 0.75 {
            return;
        }
        let mut outliers = 0.0;
        for i in 1..valid.len() {
            if (valid[i] - valid[i - 1]).abs() / valid[i - 1] > 0.25 {
                outliers += 1.0;
            }
        }
        if 1.0 - outliers / (valid.len() as f64 - 1.0) < 0.75 {
            return;
        }
        if rr.len() < 30 {
            return;
        }
        let fs = 4.0;
        let rs = resample(rr, fs);
        if rs.len() < 16 {
            return;
        }
        let (freqs, psd) = welch(&rs, fs);
        let lf = integrate(&freqs, &psd, 0.04, 0.15) * 1_000_000.0;
        let mut hf = integrate(&freqs, &psd, 0.15, 0.4) * 1_000_000.0;
        if hf < 1.0 && lf > 10.0 {
            let ext = integrate(&freqs, &psd, 0.12, 0.5) * 100.0;
            if ext > hf * 1.5 {
                hf = ext;
            }
        }
        let raw_lf = valid_value(lf, self.lf, 0.1);
        let raw_hf = valid_value(hf, self.hf, 0.1);
        let nlf = smooth_freq(raw_lf, self.lf);
        let nhf = smooth_freq(raw_hf, self.hf);
        let raw_ratio = if nhf > 0.0 { nlf / nhf } else { self.lfhf };
        self.lf = nlf;
        self.hf = nhf;
        self.lfhf = smooth_freq(valid_value(raw_ratio, self.lfhf, 0.1), self.lfhf);
        self.has_freq = [self.lf, self.hf, self.lfhf].iter().all(|v| v.is_finite() && *v >= 0.0);
    }
}
