//! T01 정본 oracle 의 ACC / GF04(HRV 게이트 16건, PPG 퇴화 입력) 패리티.
//! 퇴화 입력(flat·zeros·NaN·noise)은 v1 에서 기존 TS 동작(결함 포함)을 그대로 재현한다(감독 결정).

mod common;
use common::*;
use measurement_core::dsp::biquad::FilterImpl;
use measurement_core::dsp::hrv::HrvState;
use measurement_core::dsp::ppg::{self, PpgPoint};
use measurement_core::engine::{Cadence, Core, CoreConfig, Emission, ModelMode, Tuning, WallAnchor};
use measurement_core::parser::Sensor;
use serde_json::Value;

fn sensor_of(s: &str) -> Sensor {
    match s {
        "eeg" => Sensor::Eeg,
        "ppg" => Sensor::Ppg,
        _ => Sensor::Acc,
    }
}

#[test]
fn acc_matches_oracle() {
    let blob = read_bin("synth/stream.bin");
    let sched: Vec<(u64, String, usize, usize)> = serde_json::from_value(read_json("synth/schedule.json")).unwrap();
    let mut core = Core::with_tuning(
        CoreConfig { model_mode: ModelMode::ActiveSigmoid, ..CoreConfig::default() },
        Tuning { cadence: Cadence::LegacyPacket, emit_spectrum: false, filter: FilterImpl::Biquad },
    )
    .unwrap();
    let mut accs = Vec::new();
    for (arr, sensor, off, len) in sched {
        let out = core.push_packet(sensor_of(&sensor), &blob[off..off + len], arr, WallAnchor { wall_ms: BASE_MS, monotonic_us: 0 });
        for e in out.emissions {
            if let Emission::Acc(a) = e {
                accs.push(a);
            }
        }
    }
    let exp = read_json("expected/oracle/acc.json");
    let exp = exp.as_array().unwrap();
    assert!(!accs.is_empty());
    println!("ACC emissions rust={} oracle={}", accs.len(), exp.len());
    // oracle 는 ACC 콜백이 PPG 처리와 같이 불리는 구조일 수 있어 t_ms 로 정렬해 대조한다.
    let mut c = Cmp::default();
    let mut matched = 0usize;
    let mut nonzero_motion = 0usize;
    for e in exp {
        let t = e["t_ms"].as_f64().unwrap();
        // 같은 시각(±0ms)의 마지막 emission
        let Some(a) = accs.iter().rev().find(|a| (a.now_ms - BASE_MS as f64 - t).abs() < 0.5) else { continue };
        matched += 1;
        let r = &a.result;
        c.num("motion", &e["motion"], r.motion, 1e-9, 1e-9);
        let ix = &e["indices"];
        c.num("avgMovement", &ix["avgMovement"], Some(r.avg_movement), 1e-9, 1e-9);
        c.num("stdMovement", &ix["stdMovement"], Some(r.std_movement), 1e-9, 1e-9);
        c.num("maxMovement", &ix["maxMovement"], Some(r.max_movement), 1e-9, 1e-9);
        if r.motion.unwrap_or(0.0) > 0.0 {
            nonzero_motion += 1;
        }
    }
    println!("ACC matched={matched}/{} nonzero_motion={nonzero_motion}", exp.len());
    assert_eq!(matched, exp.len(), "oracle ACC 시각 전부에 Rust emission 이 있어야 한다");
    assert!(nonzero_motion > 0, "burst 구간(움직임>0)을 검증하지 못함");
    c.assert_ok("oracle/acc");
}

fn rr_ts_from(rr: &[f64]) -> Vec<f64> {
    let mut ts = vec![0.0; rr.len()];
    let mut t = BASE_MS as f64;
    for i in (0..rr.len()).rev() {
        ts[i] = t;
        t -= rr[i];
    }
    ts
}

#[test]
fn gf04_hrv_gate_16_cases() {
    let cases = read_json("expected/gf04/cases.json");
    let cases = cases["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 16);
    let mut c = Cmp::default();
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let rr: Vec<f64> = case["rr"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        let ts = rr_ts_from(&rr);
        let mut h = HrvState::default();
        h.process_ppg(60.0, &rr, &ts, BASE_MS as f64);
        let e = &case["independent"];
        c.eq(&format!("{name} valid_rr"), e["valid_rr"].as_u64().unwrap() as usize, h.rr_buffer_len());
        let s = h.snapshot();
        if !e["calc"].as_bool().unwrap() {
            c.eq(&format!("{name} sdnn null"), None::<f64>, s.sdnn);
            c.eq(&format!("{name} resp null"), None::<f64>, s.respiratory_rate);
            c.eq(&format!("{name} reason"), Some("insufficient_rr_buffer".to_string()), h.resp_null_reason().map(|x| x.to_string()));
            continue;
        }
        c.num(&format!("{name} sdnn"), &e["sdnn"], s.sdnn, 1e-9, 1e-9);
        if !e["avnn"].is_null() {
            c.num(&format!("{name} avnn"), &e["avnn"], s.avnn, 1e-9, 1e-9);
        }
        if e["resp_gate"] == "insufficient_window" {
            c.eq(&format!("{name} resp null"), None::<f64>, s.respiratory_rate);
            c.eq(&format!("{name} reason"), Some("insufficient_window".to_string()), h.resp_null_reason().map(|x| x.to_string()));
        } else {
            assert_ne!(h.resp_null_reason(), Some("insufficient_window"), "{name}: 게이트가 열려야 함");
        }
    }
    c.assert_ok("gf04/cases");
}

#[test]
fn gf04_sdnn_denominator_is_n() {
    let cases = read_json("expected/gf04/cases.json");
    let case = cases["cases"].as_array().unwrap().iter().find(|c| c["name"] == "sdnn_denominator_N").unwrap();
    let rr: Vec<f64> = case["rr"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
    let mut h = HrvState::default();
    h.process_ppg(60.0, &rr, &rr_ts_from(&rr), BASE_MS as f64);
    assert_eq!(h.snapshot().sdnn, Some(100.0));
}

/// gen: lcg(246004) — TS: s = (Math.imul(1664525, s) + 1013904223) >>> 0
struct Lcg(u32);
impl Lcg {
    fn next(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        self.0
    }
}

#[test]
fn gf04_ppg_degenerate_matches_ts_behavior() {
    let exp = read_json("expected/gf04/ppg_degenerate.json");
    const N: usize = 600;
    let mk = |f: &mut dyn FnMut(usize) -> (f64, f64)| -> Vec<PpgPoint> {
        (0..N)
            .map(|i| {
                let (red, ir) = f(i);
                PpgPoint { ts: BASE_MS as f64 + i as f64 * 20.0, red, ir }
            })
            .collect()
    };
    let mut r = Lcg(246004);
    // 객체 삽입 순서(flat, noise, nan_in_middle, zeros)와 난수 소비 순서가 같아야 한다 — noise 만 난수 사용.
    let flat = mk(&mut |_| (100000.0, 120000.0));
    let noise = mk(&mut |_| {
        let a = 100000.0 + (r.next() % 6001) as f64 - 3000.0;
        let b = 120000.0 + (r.next() % 6001) as f64 - 3000.0;
        (a, b)
    });
    let nan = mk(&mut |i| if i == 300 { (f64::NAN, f64::NAN) } else { (100000.0 + (i % 50) as f64 * 100.0, 120000.0 + (i % 50) as f64 * 100.0) });
    let zeros = mk(&mut |_| (0.0, 0.0));
    let mut c = Cmp::default();
    for (name, data) in [("flat", flat), ("noise", noise), ("nan_in_middle", nan), ("zeros", zeros)] {
        let res = ppg::analyze(&data, FilterImpl::Biquad);
        let e = &exp[name];
        assert_eq!(e["threw"], Value::Bool(false), "{name}");
        c.exact(&format!("{name} heartRate"), &e["vitals"]["heartRate"], Some(res.heart_rate_raw));
        c.num(&format!("{name} hrv"), &e["vitals"]["hrv"], Some(res.hrv_rmssd_simple), 1e-6, 1e-9);
        c.exact(&format!("{name} spo2"), &e["vitals"]["spo2"], Some(res.spo2));
        c.eq(&format!("{name} rr_count"), e["rr_count"].as_u64().unwrap() as usize, res.rr.len());
        let rr: Vec<f64> = e["rr"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        c.eq(&format!("{name} rr"), rr, res.rr.clone());
        c.eq(&format!("{name} peakCount"), e["peakInfo"]["peakCount"].as_u64().unwrap() as usize, res.peak_info.peak_count);
        c.num(&format!("{name} avgPeakInterval"), &e["peakInfo"]["avgPeakInterval"], Some(res.peak_info.avg_peak_interval), 1e-9, 1e-9);
        c.num(&format!("{name} peakQuality"), &e["peakInfo"]["peakQuality"], Some(res.peak_info.peak_quality), 1e-9, 1e-9);
        // sqi_overall: 숫자 또는 "NaN"(canon 직렬화)
        match &e["sqi_overall"] {
            Value::String(s) if s == "NaN" => c.eq(&format!("{name} sqi NaN"), true, res.sqi_overall_pct.is_nan()),
            v => c.num(&format!("{name} sqi"), v, Some(res.sqi_overall_pct), 1e-6, 1e-9),
        }
        let finite = res.heart_rate_raw.is_finite() && res.hrv_rmssd_simple.is_finite() && res.spo2.is_finite();
        c.eq(&format!("{name} vitals_all_finite"), e["vitals_all_finite"].as_bool().unwrap(), finite);
    }
    c.assert_ok("gf04/ppg_degenerate");
}
