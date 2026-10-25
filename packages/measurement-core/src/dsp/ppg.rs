//! PPGSignalProcessor.ts 포팅 (v1): DC 제거 + bandpass(1~5Hz), SQI, 심박(적응 임계 피크),
//! 불응기 피크(IR 원신호)→RR+피크 시각, SpO2, 피크 정보. HRV 통계는 hrv.rs.

use super::biquad::{ppg_filter, FilterImpl};
use super::math::*;
use serde::{Deserialize, Serialize};

pub const FS: f64 = 50.0;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PpgPoint {
    pub ts: f64,
    pub red: f64,
    pub ir: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeakInfo {
    pub peak_count: usize,
    pub avg_peak_interval: f64,
    pub peak_quality: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PpgResult {
    pub heart_rate_raw: f64,
    pub hrv_rmssd_simple: f64,
    pub spo2: f64,
    pub sqi_overall_pct: f64,
    pub sqi_red_pct: f64,
    pub sqi_ir_pct: f64,
    pub peak_info: PeakInfo,
    /// 윈도 내 RR(ms) 와 그것을 닫는 피크의 웹 타임라인 시각(ms)
    pub rr: Vec<f64>,
    pub rr_end_ts: Vec<f64>,
}

fn ppg_sqi(data: &[f64]) -> Vec<f64> {
    let w = 25usize;
    let n = data.len();
    let mut sqi = vec![0.0; n];
    let thr = 250.0;
    if n >= w {
        for i in 0..=(n - w) {
            let mut s = 0.0;
            for &v in &data[i..i + w] {
                let a = v.abs();
                let q = if a <= thr { 1.0 } else { js_max(0.0, 1.0 - js_min((a - thr) / thr, 1.0)) };
                s += q;
            }
            let ws = s / w as f64;
            for x in &mut sqi[i..i + w] {
                *x = ws;
            }
        }
    }
    sqi.iter().map(|v| v * 100.0).collect()
}

fn smoothing(data: &[f64], window: usize) -> Vec<f64> {
    if window <= 1 {
        return data.to_vec();
    }
    let half = window / 2;
    let n = data.len();
    (0..n)
        .map(|i| {
            let start = i.saturating_sub(half);
            let end = (n - 1).min(i + half);
            let mut s = 0.0;
            let mut c = 0.0;
            for j in start..=end {
                s += data[j];
                c += 1.0;
            }
            s / c
        })
        .collect()
}

fn detect_peaks_adaptive(data: &[f64]) -> Vec<usize> {
    let mut peaks = Vec::new();
    let w = (FS * 0.5).floor() as usize;
    let min_dist = (FS * 0.3).floor() as usize;
    if data.len() < 2 * w + 1 {
        return peaks;
    }
    for i in w..(data.len() - w) {
        let win = &data[i - w..i + w];
        let local_max = max_of(win);
        let local_mean = sum(win) / win.len() as f64;
        let thr = local_mean + (local_max - local_mean) * 0.6;
        if data[i] > thr && data[i] > data[i - 1] && data[i] > data[i + 1] && data[i] > data[i - 2] && data[i] > data[i + 2] {
            if peaks.is_empty() || i - peaks[peaks.len() - 1] >= min_dist {
                peaks.push(i);
            }
        }
    }
    peaks
}

fn rr_with_outlier_removal(peaks: &[usize]) -> Vec<f64> {
    if peaks.len() < 2 {
        return vec![];
    }
    let valid: Vec<f64> = (1..peaks.len())
        .map(|i| (peaks[i] - peaks[i - 1]) as f64 * (1000.0 / FS))
        .filter(|&rr| (200.0..=2000.0).contains(&rr))
        .collect();
    if valid.len() < 2 {
        return valid;
    }
    let mut sorted = valid.clone();
    js_sort_numeric(&mut sorted);
    let q1 = sorted[(sorted.len() as f64 * 0.25).floor() as usize];
    let q3 = sorted[(sorted.len() as f64 * 0.75).floor() as usize];
    let iqr = q3 - q1;
    let (lo, hi) = (q1 - 1.5 * iqr, q3 + 1.5 * iqr);
    valid.into_iter().filter(|&rr| rr >= lo && rr <= hi).collect()
}

fn weighted_hr(rr: &[f64]) -> f64 {
    if rr.is_empty() {
        return 0.0;
    }
    if rr.len() == 1 {
        return 60000.0 / rr[0];
    }
    let mut ws = 0.0;
    let mut tw = 0.0;
    for (i, &r) in rr.iter().enumerate() {
        let w = (i as f64 + 1.0) / rr.len() as f64;
        ws += (60000.0 / r) * w;
        tw += w;
    }
    ws / tw
}

fn validate_hr(hr: f64, rr: &[f64]) -> f64 {
    if hr < 40.0 || hr > 200.0 {
        return 0.0;
    }
    if rr.len() >= 3 {
        let mean = sum(rr) / rr.len() as f64;
        let mut s = 0.0;
        for &v in rr {
            let d = v - mean;
            s += d * d;
        }
        let std = sqrt(s / rr.len() as f64);
        if std / mean > 0.5 {
            return js_round(hr * 0.9);
        }
    }
    js_round(hr)
}

fn heart_rate(data: &[f64]) -> f64 {
    if data.len() < 50 {
        return 0.0;
    }
    let sm = smoothing(data, 3);
    let mean = sum(&sm) / sm.len() as f64;
    let norm: Vec<f64> = sm.iter().map(|&v| v - mean).collect();
    if sqrt(variance(&norm)) < 10.0 {
        return 0.0;
    }
    let peaks = detect_peaks_adaptive(&norm);
    if peaks.len() < 2 {
        return 0.0;
    }
    let rr = rr_with_outlier_removal(&peaks);
    if rr.is_empty() {
        return 0.0;
    }
    validate_hr(weighted_hr(&rr), &rr)
}

fn peaks_refractory(norm: &[f64], ratio: f64, refractory_ms: f64) -> Vec<usize> {
    let mut peaks: Vec<usize> = Vec::new();
    if norm.len() < 3 {
        return peaks;
    }
    let refr = js_round(refractory_ms * (FS / 1000.0)).max(1.0) as i64;
    let mut sorted = norm.to_vec();
    js_sort_numeric(&mut sorted);
    let p90 = sorted[((sorted.len() - 1) as f64 * 0.9).floor() as usize];
    let bootstrap = js_max(p90 * ratio, 0.0);
    let mut recent: Vec<f64> = Vec::new();
    for i in 1..norm.len() - 1 {
        if !(norm[i] > norm[i - 1] && norm[i] >= norm[i + 1]) {
            continue;
        }
        let mut thr = bootstrap;
        if recent.len() >= 3 {
            thr = (sum(&recent) / recent.len() as f64) * ratio;
        }
        if norm[i] < thr {
            continue;
        }
        let last: i64 = peaks.last().map(|&p| p as i64).unwrap_or(i64::MIN / 2);
        if (i as i64) - last < refr {
            if let Some(&lp) = peaks.last() {
                if norm[i] > norm[lp] {
                    let l = peaks.len() - 1;
                    peaks[l] = i;
                    if let Some(r) = recent.last_mut() {
                        *r = norm[i];
                    }
                }
            }
            continue;
        }
        peaks.push(i);
        recent.push(norm[i]);
        if recent.len() > 8 {
            recent.remove(0);
        }
    }
    peaks
}

fn simple_hrv(data: &[f64]) -> f64 {
    if data.len() < 30 {
        return 0.0;
    }
    let mean = sum(data) / data.len() as f64;
    let norm: Vec<f64> = data.iter().map(|&v| v - mean).collect();
    let peaks = peaks_refractory(&norm, 0.5, 300.0);
    if peaks.len() < 2 {
        return 0.0;
    }
    let rr: Vec<f64> = (1..peaks.len())
        .map(|i| (peaks[i] - peaks[i - 1]) as f64 * (1000.0 / FS))
        .filter(|&r| (200.0..=2000.0).contains(&r))
        .collect();
    if rr.len() < 2 {
        return 0.0;
    }
    let mut s = 0.0;
    for i in 1..rr.len() {
        let d = rr[i] - rr[i - 1];
        s += d * d;
    }
    sqrt(s / (rr.len() - 1) as f64)
}

fn pulsatile(data: &[f64]) -> f64 {
    if data.len() < 10 {
        return 0.0;
    }
    let sm = smoothing(data, 3);
    let mut peaks = Vec::new();
    let mut valleys = Vec::new();
    for i in 1..sm.len() - 1 {
        if sm[i] > sm[i - 1] && sm[i] > sm[i + 1] {
            peaks.push(sm[i]);
        }
        if sm[i] < sm[i - 1] && sm[i] < sm[i + 1] {
            valleys.push(sm[i]);
        }
    }
    if peaks.is_empty() || valleys.is_empty() {
        return max_of(&sm) - min_of(&sm);
    }
    let ap = sum(&peaks) / peaks.len() as f64;
    let av = sum(&valleys) / valleys.len() as f64;
    (ap - av).abs()
}

fn spo2(red: &[f64], ir: &[f64]) -> f64 {
    if red.is_empty() || ir.is_empty() || red.len() != ir.len() {
        return 0.0;
    }
    let rs = sqrt(variance(red));
    let is = sqrt(variance(ir));
    if rs < 10.0 || is < 10.0 {
        return 0.0;
    }
    let rac = pulsatile(red);
    let iac = pulsatile(ir);
    let rdc = sum(red) / red.len() as f64;
    let idc = sum(ir) / ir.len() as f64;
    if rdc == 0.0 || idc == 0.0 || rac == 0.0 || iac == 0.0 {
        return 0.0;
    }
    let rr = rac / rdc;
    let ir_ = iac / idc;
    if ir_ == 0.0 {
        return 0.0;
    }
    let r = rr / ir_;
    let knots = [(0.4, 100.0), (1.0, 85.0), (1.6, 70.0)];
    let mut s = if r <= knots[0].0 {
        knots[0].1
    } else if r >= knots[2].0 {
        knots[2].1
    } else {
        let mut out = knots[2].1;
        for i in 1..knots.len() {
            let (a, b) = (knots[i - 1], knots[i]);
            if r <= b.0 {
                let t = (r - a.0) / (b.0 - a.0);
                out = a.1 + t * (b.1 - a.1);
                break;
            }
        }
        out
    };
    let qf = js_min(rs, is) / js_max(rs, is);
    if qf < 0.5 {
        s = s * 0.95 + 95.0 * 0.05;
    }
    js_round(s.clamp(70.0, 100.0))
}

fn analyze_peaks(red: &[f64]) -> PeakInfo {
    if red.len() < 25 {
        return PeakInfo { peak_count: 0, avg_peak_interval: 0.0, peak_quality: 0.0 };
    }
    let mean = sum(red) / red.len() as f64;
    let norm: Vec<f64> = red.iter().map(|&v| v - mean).collect();
    let peaks = peaks_refractory(&norm, 0.4, 300.0);
    let mut avg = 0.0;
    let mut quality = 0.0;
    if peaks.len() > 1 {
        let iv: Vec<f64> = (1..peaks.len()).map(|i| (peaks[i] - peaks[i - 1]) as f64).collect();
        avg = sum(&iv) / iv.len() as f64;
    }
    if peaks.len() >= 3 {
        let iv: Vec<f64> = (1..peaks.len()).map(|i| (peaks[i] - peaks[i - 1]) as f64).collect();
        let m = sum(&iv) / iv.len() as f64;
        let mut s = 0.0;
        for &v in &iv {
            let d = v - m;
            s += d * d;
        }
        let std = sqrt(s / iv.len() as f64);
        quality = (1.0 - std / m).clamp(0.0, 1.0);
    }
    PeakInfo { peak_count: peaks.len(), avg_peak_interval: avg, peak_quality: quality }
}

/// 윈도 1개 분석(`data.len() >= 50` 는 호출자 책임).
pub fn analyze(data: &[PpgPoint], imp: FilterImpl) -> PpgResult {
    let processed: &[PpgPoint] = if data.len() >= 500 {
        &data[100..data.len() - 100]
    } else if data.len() > 150 {
        &data[100..]
    } else {
        data
    };
    let red: Vec<f64> = processed.iter().map(|p| p.red).collect();
    let ir: Vec<f64> = processed.iter().map(|p| p.ir).collect();
    let f_red = ppg_filter(&red, imp);
    let f_ir = ppg_filter(&ir, imp);
    let s_red = ppg_sqi(&f_red);
    let s_ir = ppg_sqi(&f_ir);
    let overall: Vec<f64> = s_red.iter().zip(&s_ir).map(|(a, b)| (a + b) / 2.0).collect();
    let avg = sum(&overall) / overall.len() as f64;
    let hr = heart_rate(&f_ir);
    let hrv = simple_hrv(&f_ir);
    let sp = spo2(&red, &ir);

    // RR: 원신호 IR 평균 제거 → 불응기 피크
    let mean = sum(&ir) / ir.len() as f64;
    let norm: Vec<f64> = ir.iter().map(|&v| v - mean).collect();
    let peaks = peaks_refractory(&norm, 0.5, 300.0);
    let mut rr = Vec::new();
    let mut rr_ts = Vec::new();
    if peaks.len() >= 2 {
        for i in 1..peaks.len() {
            let iv = (peaks[i] - peaks[i - 1]) as f64 * (1000.0 / FS);
            if (200.0..=2000.0).contains(&iv) {
                rr.push(iv);
                rr_ts.push(processed[peaks[i]].ts);
            }
        }
    }
    // filteredRawData.red = filteredRed[idx] || point.red  (0 → 원값)
    let fr: Vec<f64> = f_red.iter().zip(&red).map(|(&f, &r)| if f == 0.0 || f.is_nan() { r } else { f }).collect();
    let peak_info = analyze_peaks(&fr);

    PpgResult {
        heart_rate_raw: hr,
        hrv_rmssd_simple: hrv,
        spo2: sp,
        sqi_overall_pct: avg,
        sqi_red_pct: sum(&s_red) / s_red.len() as f64,
        sqi_ir_pct: sum(&s_ir) / s_ir.len() as f64,
        peak_info,
        rr,
        rr_end_ts: rr_ts,
    }
}
