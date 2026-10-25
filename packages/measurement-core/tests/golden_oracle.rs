//! T01 oracle 전체 재생 패리티: synth/stream.bin + schedule.json → Rust 코어 → expected/oracle/*.json.
//! expected 는 기존 TS(수정 없이)가 만든 값. 정수·분기(피크 위치·RR·null)는 exact, 실수는 N07.

mod common;
use common::*;
use measurement_core::dsp::biquad::FilterImpl;
use measurement_core::dsp::score::{ModelParams, SigmoidParam};
use measurement_core::engine::{Cadence, Core, CoreConfig, Emission, ModelMode, Tuning, WallAnchor};
use measurement_core::parser::Sensor;
use serde_json::Value;

pub fn pinned_model() -> ModelParams {
    // contracts/biosignal-golden/v1/oracle/run-oracle.ts#pinnedModel
    let mut m = ModelParams::new();
    for (k, mm, s, d) in [
        ("focusIndex", 0.3, 0.8, 1),
        ("relaxationIndex", -1.4, 0.5, 1),
        ("stressIndex", 0.2, 0.9, -1),
        ("totalNeuralActivity", 5.0, 2.0, 1),
        ("faa", 0.0, 0.6, -1),
        ("cognitiveLoad", 1.1, 0.4, -1),
        ("emotionalStability", 0.5, 0.9, 1),
    ] {
        m.insert(k.to_string(), SigmoidParam { m: mm, s, direction: d });
    }
    m
}

fn sensor_of(s: &str) -> Sensor {
    match s {
        "eeg" => Sensor::Eeg,
        "ppg" => Sensor::Ppg,
        _ => Sensor::Acc,
    }
}

struct Run {
    emissions: Vec<Emission>,
}

fn replay(batch: Option<usize>) -> Run {
    let blob = read_bin("synth/stream.bin");
    let sched: Vec<(u64, String, usize, usize)> =
        serde_json::from_value::<Vec<(u64, String, usize, usize)>>(read_json("synth/schedule.json")).unwrap();
    let mut core = Core::with_tuning(
        CoreConfig { model_mode: ModelMode::ActiveSigmoid, ..CoreConfig::default() },
        Tuning { cadence: Cadence::LegacyPacket, emit_spectrum: true, filter: FilterImpl::LegacyFallback },
    )
    .unwrap();
    core.set_model(pinned_model());
    let _ = batch;
    let mut em = Vec::new();
    for (arr, sensor, off, len) in sched {
        let out = core.push_packet(sensor_of(&sensor), &blob[off..off + len], arr, WallAnchor { wall_ms: BASE_MS, monotonic_us: 0 });
        em.extend(out.emissions);
    }
    Run { emissions: em }
}

fn rel(ms: f64) -> f64 {
    ms - BASE_MS as f64
}

#[test]
fn eeg_stages_match_oracle() {
    let run = replay(None);
    let eegs: Vec<_> = run.emissions.iter().filter_map(|e| if let Emission::Eeg(x) = e { Some(x) } else { None }).collect();
    let psd = read_json("expected/oracle/eeg_psd_bandpower.json");
    let raw = read_json("expected/oracle/eeg_raw_indices.json");
    let disp = read_json("expected/oracle/display.json");
    let (psd, raw, disp) = (psd.as_array().unwrap(), raw.as_array().unwrap(), disp.as_array().unwrap());
    assert_eq!(eegs.len(), psd.len(), "EEG emission 개수(윈도 경계·throttle) 불일치");
    let mut c = Cmp::default();
    for (i, e) in eegs.iter().enumerate() {
        c.eq(&format!("[{i}] t_ms(윈도 경계)"), psd[i]["t_ms"].as_f64().unwrap(), rel(e.now_ms));
        let r = &e.result;
        let b = &psd[i]["bandPowers"];
        for (k, v) in [("delta", r.bands.delta), ("theta", r.bands.theta), ("alpha", r.bands.alpha), ("beta", r.bands.beta), ("gamma", r.bands.gamma)] {
            c.num(&format!("[{i}] band.{k}"), &b[k], Some(v), 1e-6, 1e-6);
        }
        let q = &psd[i]["signalQuality"];
        c.num(&format!("[{i}] sqi.overall"), &q["overall"], Some(r.sqi_overall_pct), 1e-6, 1e-6);
        c.num(&format!("[{i}] sqi.fp1"), &q["fp1"], Some(r.sqi_fp1_pct), 1e-6, 1e-6);
        c.num(&format!("[{i}] sqi.fp2"), &q["fp2"], Some(r.sqi_fp2_pct), 1e-6, 1e-6);
        let sp = r.spectrum.as_ref().unwrap();
        let (p1, p2) = (psd[i]["spectrum"]["ch1Power"].as_array().unwrap(), psd[i]["spectrum"]["ch2Power"].as_array().unwrap());
        c.eq(&format!("[{i}] spectrum len"), p1.len(), sp.ch1_power.len());
        for (k, (a, b)) in p1.iter().zip(&sp.ch1_power).enumerate() {
            c.num(&format!("[{i}] ch1_power[{k}]"), a, Some(*b), 1e-6, 1e-6);
        }
        for (k, (a, b)) in p2.iter().zip(&sp.ch2_power).enumerate() {
            c.num(&format!("[{i}] ch2_power[{k}]"), a, Some(*b), 1e-6, 1e-6);
        }
        c.eq(&format!("[{i}] filtered n"), psd[i]["filtered"]["n"].as_u64().unwrap() as usize, r.filtered_len);
        let x = &r.indices;
        let ri = &raw[i];
        for (k, v) in [
            ("focusIndex", x.focus_index),
            ("relaxationIndex", x.relaxation_index),
            ("stressIndex", x.stress_index),
            ("hemisphericBalance", x.hemispheric_balance),
            ("cognitiveLoad", x.cognitive_load),
            ("emotionalStability", x.emotional_stability),
            ("totalNeuralActivity", x.total_neural_activity),
        ] {
            c.num(&format!("[{i}] {k}"), &ri[k], Some(v), 1e-6, 1e-6);
        }
        c.num(&format!("[{i}] faa"), &ri["faa"], x.faa, 1e-6, 1e-6);
        // 표시값(0.1 단위 이내가 아니라 정수 완전 일치)
        let d = &disp[i];
        let g = |m: &measurement_core::dsp::score::ScoreSet| [m.focus, m.relaxation, m.stress, m.total_power, m.hemispheric_balance, m.cognitive_load, m.emotional_stability];
        let keys = ["focusIndex", "relaxationIndex", "stressIndex", "totalPower", "hemisphericBalance", "cognitiveLoad", "emotionalStability"];
        for (k, v) in keys.iter().zip(g(&e.scores_cohort)) {
            c.exact(&format!("[{i}] legacy_cohort.{k}"), &d["legacy_cohort"][*k], Some(v));
        }
        for (k, v) in keys.iter().zip(g(&e.scores_model.unwrap())) {
            c.exact(&format!("[{i}] active_sigmoid.{k}"), &d["active_sigmoid"][*k], Some(v));
        }
    }
    c.assert_ok("oracle/eeg+display");
}

#[test]
fn ppg_hrv_respiration_stages_match_oracle() {
    let run = replay(None);
    let ppgs: Vec<_> = run.emissions.iter().filter_map(|e| if let Emission::Ppg(x) = e { Some(x) } else { None }).collect();
    let pk = read_json("expected/oracle/ppg_peaks_rr.json");
    let hv = read_json("expected/oracle/hrv_sdnn_respiration.json");
    let (pk, hv) = (pk.as_array().unwrap(), hv.as_array().unwrap());
    assert_eq!(ppgs.len(), pk.len(), "PPG emission 개수 불일치");
    let mut c = Cmp::default();
    let (mut null_sdnn, mut val_sdnn, mut null_resp, mut val_resp) = (0, 0, 0, 0);
    for (i, p) in ppgs.iter().enumerate() {
        c.eq(&format!("[{i}] t_ms"), pk[i]["t_ms"].as_f64().unwrap(), rel(p.now_ms));
        let r = &p.result;
        let v = &pk[i]["vitals"];
        c.exact(&format!("[{i}] heartRate"), &v["heartRate"], Some(r.heart_rate_raw));
        c.num(&format!("[{i}] hrv(simple)"), &v["hrv"], Some(r.hrv_rmssd_simple), 1e-4, 1e-6);
        c.exact(&format!("[{i}] spo2"), &v["spo2"], Some(r.spo2));
        c.num(&format!("[{i}] sqi_overall"), &pk[i]["sqi_overall"], Some(r.sqi_overall_pct), 1e-6, 1e-6);
        c.eq(&format!("[{i}] peakCount"), pk[i]["peakInfo"]["peakCount"].as_u64().unwrap() as usize, r.peak_info.peak_count);
        c.num(&format!("[{i}] avgPeakInterval"), &pk[i]["peakInfo"]["avgPeakInterval"], Some(r.peak_info.avg_peak_interval), 1e-9, 1e-9);
        c.num(&format!("[{i}] peakQuality"), &pk[i]["peakInfo"]["peakQuality"], Some(r.peak_info.peak_quality), 1e-9, 1e-9);
        // RR / 피크 시각은 분기 — 정확 일치. 입력은 엔진이 쓰는 PPG 윈도 전체(TS 는 호출 시점 RR 만 기록).
        let rr: Vec<f64> = pk[i]["rr"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        let ts: Vec<f64> = pk[i]["rr_end_ts_rel_ms"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        if !rr.is_empty() || !r.rr.is_empty() {
            c.eq(&format!("[{i}] rr"), rr, r.rr.clone());
            let got: Vec<f64> = r.rr_end_ts.iter().map(|t| rel(*t)).collect();
            for (k, (a, b)) in ts.iter().zip(&got).enumerate() {
                c.num(&format!("[{i}] rr_ts[{k}]"), &Value::from(*a), Some(*b), 1e-6, 1e-9);
            }
            c.eq(&format!("[{i}] rr_ts len"), ts.len(), got.len());
        }
        let h = &hv[i]["hrv"];
        let s = &p.hrv;
        // BPM/호흡/SDNN abs≤1e-4 (N07), 나머지 DSP abs≤1e-6
        c.num(&format!("[{i}] sdnn"), &h["sdnn"], s.sdnn, 1e-4, 1e-6);
        c.num(&format!("[{i}] respiratoryRate"), &h["respiratoryRate"], s.respiratory_rate, 1e-4, 1e-6);
        c.num(&format!("[{i}] heartRate(smoothed)"), &h["heartRate"], s.heart_rate, 1e-4, 1e-6);
        c.num(&format!("[{i}] rmssd"), &h["rmssd"], s.rmssd, 1e-6, 1e-6);
        c.num(&format!("[{i}] pnn50"), &h["pnn50"], s.pnn50, 1e-6, 1e-6);
        c.num(&format!("[{i}] pnn20"), &h["pnn20"], s.pnn20, 1e-6, 1e-6);
        c.num(&format!("[{i}] sdsd"), &h["sdsd"], s.sdsd, 1e-6, 1e-6);
        c.num(&format!("[{i}] avnn"), &h["avnn"], s.avnn, 1e-6, 1e-6);
        c.num(&format!("[{i}] stressIndex"), &h["stressIndex"], s.stress_index, 1e-6, 1e-6);
        c.num(&format!("[{i}] lfPower"), &h["lfPower"], s.lf_power, 1e-6, 1e-6);
        c.num(&format!("[{i}] hfPower"), &h["hfPower"], s.hf_power, 1e-6, 1e-6);
        c.num(&format!("[{i}] lfHfRatio"), &h["lfHfRatio"], s.lf_hf_ratio, 1e-6, 1e-6);
        c.exact(&format!("[{i}] hrMax"), &h["hrMax"], s.hr_max);
        c.exact(&format!("[{i}] hrMin"), &h["hrMin"], s.hr_min);
        c.eq(&format!("[{i}] resp_null_reason"), hv[i]["respiratory_null_reason"].as_str().map(|s| s.to_string()), p.resp_null_reason.clone());
        c.eq(&format!("[{i}] rr_buffer"), hv[i]["rr_buffer"]["bufferLength"].as_u64().unwrap() as usize, p.rr_buffer_len);
        if s.sdnn.is_none() { null_sdnn += 1 } else { val_sdnn += 1 }
        if s.respiratory_rate.is_none() { null_resp += 1 } else { val_resp += 1 }
    }
    println!("PPG windows={} sdnn null/val={null_sdnn}/{val_sdnn} resp null/val={null_resp}/{val_resp}", ppgs.len());
    assert!(null_sdnn > 0 && val_sdnn > 0 && null_resp > 0 && val_resp > 0, "gate 전이(null→값)를 모두 지나야 함");
    c.assert_ok("oracle/ppg+hrv");
}
