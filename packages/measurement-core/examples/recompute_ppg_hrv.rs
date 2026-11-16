//! 저장값 재산출용(SDD fix-rmssd): 연속 구간 PPG 원시 샘플을 표준입력으로 받아 서비스와 같은 방식으로 재생한다.
//! 입력(stdin, 줄 단위): `ts_ms,red,ir` — 50Hz 연속 구간 하나(구간이 끊기면 호출자가 프로세스를 새로 띄운다).
//! 동작: 착용 게이트(라이브 엔진 `WearState` 와 동일) → 500샘플 링버퍼 + 50샘플(1초)마다 `ppg::analyze` → `HrvState::process_ppg`.
//!       미착용 틱과 맥박 품질 게이트 탈락 틱은 값을 비운다(서비스는 빈 값을 "건드리지 않음"으로 처리).
//! 출력(stdout): `ts_ms,rmssd,sdnn,lf_power,hf_power,lf_hf_ratio,heart_rate` — 값이 없으면 빈 칸.
//!
//! 배경(specs/fix-rmssd-overestimate/dev-recompute-findings.md): 착용 게이트 없이 원시 전체를 넣으면
//! 미착용·책상 위 잡음 구간에도 RMSSD 가 나와 정상 값을 잡음 값으로 덮어쓴다.
use measurement_core::dsp::biquad::{ppg_filter_zero_phase, FilterImpl};
use measurement_core::dsp::hrv::{HrvSnapshot, HrvState};
use measurement_core::dsp::ppg::{self, PpgPoint};
use std::io::{BufRead, Write};

// ── 착용 판정: `src/engine.rs` 의 WEAR_OFF_IR / WEAR_ON_IR / WEAR_HOLD_SAMPLES / WearState 와 반드시 같아야 한다.
//    (엔진 쪽은 pub(crate)·비공개라 예제에 복제. 라이브 규칙을 바꾸면 여기도 함께 바꾼다.)
const WEAR_OFF_IR: f64 = 100_000.0;
const WEAR_ON_IR: f64 = 500_000.0;
const WEAR_HOLD_SAMPLES: u32 = 150;

// ── 맥박 품질 게이트(재산출 전용). 근거: dev 조사 — 잡음 구간 교류 SD 0.8~3.0, 실제 맥박 ≥ 9.6 → 사이 6.0.
/// 1~5Hz 영위상 필터 IR 의 표준편차(카운트) 하한. 이 미만이면 맥박이 없는 신호로 본다.
const PULSE_AC_MIN_SD: f64 = 6.0;
/// 유효 RR(창 RR 중앙값 ±25% 이내) 비율 하한.
const VALID_RR_MIN_RATIO: f64 = 0.5;
/// 유효 RR 판정 허용폭(중앙값 대비).
const RR_MEDIAN_TOLERANCE: f64 = 0.25;
/// 비율을 믿으려면 필요한 최소 RR 개수.
const MIN_RR_FOR_RATIO: usize = 3;
/// 링 길이(10초 @50Hz). 게이트는 링이 가득 찼을 때만 판단한다.
const RING: usize = 500;

#[derive(Clone, Copy, Debug)]
struct WearState {
    worn: bool,
    low_run: u32,
    high_run: u32,
}
impl Default for WearState {
    fn default() -> Self {
        WearState { worn: true, low_run: 0, high_run: 0 }
    }
}
impl WearState {
    /// 샘플 1개 반영. 상태가 바뀌면 Some(새 worn).
    fn update(&mut self, ir: f64) -> Option<bool> {
        if ir < WEAR_OFF_IR {
            self.low_run = self.low_run.saturating_add(1);
            self.high_run = 0;
        } else if ir >= WEAR_ON_IR {
            self.high_run = self.high_run.saturating_add(1);
            self.low_run = 0;
        } else {
            self.low_run = 0;
            self.high_run = 0;
        }
        if self.worn && self.low_run >= WEAR_HOLD_SAMPLES {
            self.worn = false;
            self.low_run = 0;
            return Some(false);
        }
        if !self.worn && self.high_run >= WEAR_HOLD_SAMPLES {
            self.worn = true;
            self.high_run = 0;
            return Some(true);
        }
        None
    }
}

/// IR 1~5Hz 영위상 필터 후 표준편차(카운트).
fn ac_sd(ring: &[PpgPoint]) -> f64 {
    let ir: Vec<f64> = ring.iter().map(|p| p.ir).collect();
    let f = ppg_filter_zero_phase(&ir, FilterImpl::Biquad);
    let n = f.len() as f64;
    if n < 2.0 {
        return 0.0;
    }
    let mean = f.iter().sum::<f64>() / n;
    (f.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n).sqrt()
}

/// 창 RR 중 중앙값 ±25% 이내 비율. RR 이 너무 적으면 0.
fn valid_rr_ratio(rr: &[f64]) -> f64 {
    if rr.len() < MIN_RR_FOR_RATIO {
        return 0.0;
    }
    let mut s = rr.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = s[s.len() / 2];
    let ok = rr.iter().filter(|&&v| (v - med).abs() <= med * RR_MEDIAN_TOLERANCE).count();
    ok as f64 / rr.len() as f64
}

/// 맥박 품질 게이트: 교류 SD ≥ PULSE_AC_MIN_SD 그리고 유효 RR 비율 ≥ VALID_RR_MIN_RATIO.
fn pulse_gate_pass(ac_sd: f64, rr: &[f64]) -> bool {
    ac_sd >= PULSE_AC_MIN_SD && valid_rr_ratio(rr) >= VALID_RR_MIN_RATIO
}

/// 재산출 재생기. 샘플을 하나씩 먹이고, 50샘플마다 틱(ts, 출력 스냅샷 또는 None)을 낸다.
struct Replayer {
    ring: Vec<PpgPoint>,
    hrv: HrvState,
    wear: WearState,
    n: usize,
}
impl Replayer {
    fn new() -> Self {
        Replayer { ring: Vec::new(), hrv: HrvState::default(), wear: WearState::default(), n: 0 }
    }
    fn push(&mut self, ts: f64, red: f64, ir: f64) -> Option<(f64, Option<HrvSnapshot>)> {
        if self.wear.update(ir).is_some() {
            self.ring.clear();
            self.hrv.reset_for_not_worn();
        }
        if self.wear.worn {
            self.ring.push(PpgPoint { ts, red, ir });
            if self.ring.len() > RING {
                self.ring.remove(0);
            }
        }
        self.n += 1;
        if self.n % 50 != 0 {
            return None;
        }
        if !self.wear.worn || self.ring.len() < 50 {
            return Some((ts, None));
        }
        let res = ppg::analyze(&self.ring, FilterImpl::Biquad);
        self.hrv.process_ppg(res.heart_rate_raw, &res.rr, &res.rr_end_ts, ts);
        let pass = self.ring.len() >= RING && pulse_gate_pass(ac_sd(&self.ring), &res.rr);
        Some((ts, if pass { Some(self.hrv.snapshot()) } else { None }))
    }
}

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let mut rp = Replayer::new();
    writeln!(out, "ts_ms,rmssd,sdnn,lf_power,hf_power,lf_hf_ratio,heart_rate").unwrap();
    let f = |v: Option<f64>| v.map(|x| format!("{x:.6}")).unwrap_or_default();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let mut it = line.split(',');
        let (Some(a), Some(b), Some(c)) = (it.next(), it.next(), it.next()) else { continue };
        let (Ok(ts), Ok(red), Ok(ir)) = (a.trim().parse::<f64>(), b.trim().parse::<f64>(), c.trim().parse::<f64>()) else { continue };
        if let Some((t, snap)) = rp.push(ts, red, ir) {
            match snap {
                Some(s) => writeln!(out, "{},{},{},{},{},{},{}", t, f(s.rmssd), f(s.sdnn), f(s.lf_power), f(s.hf_power), f(s.lf_hf_ratio), f(s.heart_rate)).unwrap(),
                None => writeln!(out, "{t},,,,,,").unwrap(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 결정적 의사난수(-1..1).
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 33) as f64 / (1u64 << 31) as f64) * 2.0 - 1.0
        }
    }

    /// 맥박 합성: RR 평균 ~830ms(72bpm) 지터 ±30ms, 박동당 가우시안 펄스(폭 ~80ms).
    fn pulse_ir(seconds: usize, dc: f64, amp: f64, seed: u64) -> Vec<f64> {
        let mut r = Lcg(seed);
        let mut beats = Vec::new();
        let mut t = 0.3;
        while t < seconds as f64 + 2.0 {
            beats.push(t);
            t += 0.83 + 0.03 * r.next();
        }
        (0..seconds * 50)
            .map(|i| {
                let ts = i as f64 / 50.0;
                let p: f64 = beats.iter().map(|b| (-((ts - b) / 0.08).powi(2)).exp()).sum();
                dc + amp * p
            })
            .collect()
    }
    fn noise_ir(seconds: usize, dc: f64, sigma: f64, seed: u64) -> Vec<f64> {
        let mut r = Lcg(seed);
        (0..seconds * 50).map(|_| dc + sigma * r.next()).collect()
    }
    fn replay(ir: &[f64]) -> Vec<(f64, Option<HrvSnapshot>)> {
        let mut rp = Replayer::new();
        ir.iter().enumerate().filter_map(|(i, &v)| rp.push(i as f64 * 20.0, v * 0.8, v)).collect()
    }
    fn has_value(t: &(f64, Option<HrvSnapshot>)) -> bool {
        t.1.as_ref().map_or(false, |s| s.rmssd.is_some())
    }

    #[test]
    fn v1_worn_pulse_emits_values() {
        let ticks = replay(&pulse_ir(60, 1_420_000.0, 200.0, 1));
        let late: Vec<_> = ticks.iter().skip(20).collect();
        let n = late.iter().filter(|t| has_value(t)).count();
        assert!(n * 2 >= late.len(), "착용 맥박인데 값 틱이 너무 적다: {n}/{}", late.len());
    }

    #[test]
    fn v2_desk_noise_dc_300k_to_900k_emits_nothing() {
        // 라이브 규칙으론 착용으로 통과하는 DC 대역(초기 상태=착용)도 맥박 게이트가 막아야 한다. 교류 SD 1~3.
        for (k, dc) in [300_000.0, 400_000.0, 650_000.0, 880_000.0].iter().enumerate() {
            let ticks = replay(&noise_ir(60, *dc, 4.0, 10 + k as u64));
            assert!(ticks.iter().all(|t| !has_value(t)), "dc={dc} 잡음에서 값이 나왔다");
        }
    }

    #[test]
    fn v3_not_worn_low_dc_emits_nothing() {
        let ticks = replay(&noise_ir(60, 6_100.0, 5.0, 3));
        assert!(!ticks.is_empty());
        assert!(ticks.iter().all(|t| !has_value(t)));
    }

    #[test]
    fn v4_transition_worn_off_worn_resumes() {
        let mut ir = pulse_ir(40, 1_420_000.0, 200.0, 5);
        ir.extend(noise_ir(30, 6_100.0, 5.0, 6));
        ir.extend(pulse_ir(60, 1_420_000.0, 200.0, 7));
        let ticks = replay(&ir);
        let off: Vec<_> = ticks.iter().filter(|t| t.0 / 1000.0 > 44.0 && t.0 / 1000.0 < 70.0).collect();
        assert!(!off.is_empty() && off.iter().all(|t| !has_value(t)), "미착용 구간에 값이 나왔다");
        let back: Vec<_> = ticks.iter().filter(|t| t.0 / 1000.0 > 90.0).collect();
        assert!(back.iter().any(|t| has_value(t)), "복귀 후 값이 재개되지 않았다");
    }

    #[test]
    fn v5_gate_thresholds() {
        let good: Vec<f64> = vec![830.0; 10];
        assert!(!pulse_gate_pass(5.9, &good));
        assert!(pulse_gate_pass(6.0, &good));
        // RR 이 중앙값 근처에 모여 있으면 통과, 넓게 흩어져 있으면(35%만 ±25% 이내) 탈락
        let spread: Vec<f64> = (0..100).map(|i| 300.0 + i as f64 * 15.0).collect();
        assert!(valid_rr_ratio(&spread) < VALID_RR_MIN_RATIO);
        assert!(!pulse_gate_pass(10.0, &spread));
        assert!(!pulse_gate_pass(10.0, &[800.0, 810.0])); // RR 너무 적음
    }

    #[test]
    fn v6_wear_hysteresis_matches_live_constants() {
        let mut w = WearState::default();
        let mut flips = vec![];
        for i in 0..400 {
            if let Some(v) = w.update(10_000.0) {
                flips.push((i, v));
            }
        }
        assert_eq!(flips, vec![(WEAR_HOLD_SAMPLES as usize - 1, false)]);
        // 중간 DC(50만 미만)는 미착용 → 착용 복귀를 만들지 않는다.
        for _ in 0..1000 {
            assert!(w.update(300_000.0).is_none());
        }
        assert!(!w.worn);
    }
}
