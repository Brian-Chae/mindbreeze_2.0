//! SDD-273 — 네이티브(FFI 와 같은 api 경로: parse_config → set_model_json → push_raw)로 골든 stream 을 재생해
//! 프레임별 표시 지표(focus/relaxation/emotion display + bpm/respiration/sdnn)를 JSON 으로 낸다. WASM 패리티 기준.
//! usage: replay_model <golden synth dir> <config.json> [model.json]
use measurement_core::api::{parse_config, push_raw, set_model_json};
use measurement_core::engine::Core;
use serde_json::{json, Value};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let dir = &a[1];
    let cfg = parse_config(&std::fs::read(&a[2]).unwrap()).map_err(|e| e.to_json()).unwrap();
    let mut core = Core::with_tuning(cfg, measurement_core::engine::Tuning::default()).unwrap();
    if let Some(m) = a.get(3) {
        set_model_json(&mut core, &std::fs::read(m).unwrap()).map_err(|e| e.to_json()).unwrap();
    }
    let blob = std::fs::read(format!("{dir}/stream.bin")).unwrap();
    let sched: Vec<(u64, String, usize, usize)> = serde_json::from_slice(&std::fs::read(format!("{dir}/schedule.json")).unwrap()).unwrap();
    let mut rows = Vec::new();
    for (arr, s, off, len) in sched {
        let code = match s.as_str() { "eeg" => 0u8, "ppg" => 1, _ => 2 };
        let out: Value = serde_json::from_str(&push_raw(&mut core, code, &blob[off..off + len], arr, 1_760_000_000_000, 0).map_err(|e| e.to_json()).unwrap()).unwrap();
        for f in out["frames"].as_array().unwrap() {
            let g = |k: &str| f["metrics"][k]["value"].clone();
            rows.push(json!({"seq": f["sequence"], "focus": g("focus_display"), "relax": g("relaxation_display"), "emotion": g("emotion_display"), "bpm": g("bpm"), "resp": g("respiration"), "sdnn": g("sdnn")}));
        }
    }
    println!("{}", serde_json::to_string(&rows).unwrap());
}
