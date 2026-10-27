//! EEG 패킷 재생(pk_*.json: [{mono(µs), hex}]) → 프레임별 EEG 지표를 TSV 로 출력. 수정 전/후 비교용.
//! usage: replay_pk packets.json [drop_from drop_to]   (패킷 인덱스 구간 삭제 = 갭 주입)
use measurement_core::engine::{Core, CoreConfig, WallAnchor};
use measurement_core::parser::Sensor;
use serde_json::Value;
fn hex(s: &str) -> Vec<u8> { (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect() }
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let v: Vec<Value> = serde_json::from_slice(&std::fs::read(&a[1]).unwrap()).unwrap();
    let drop: Option<(usize, usize)> = if a.len() > 3 { Some((a[2].parse().unwrap(), a[3].parse().unwrap())) } else { None };
    let mut core = Core::new(CoreConfig::default()).unwrap();
    let t0 = v[0]["mono"].as_u64().unwrap();
    let anchor = WallAnchor { wall_ms: 1_793_000_000_000, monotonic_us: t0 };
    for (k, p) in v.iter().enumerate() {
        if let Some((f, t)) = drop { if k >= f && k < t { continue; } }
        let mono = p["mono"].as_u64().unwrap();
        let out = core.push_packet(Sensor::Eeg, &hex(p["hex"].as_str().unwrap()), mono, anchor);
        for f in &out.frames {
            let m = &f.metrics;
            let fmt = |x: &measurement_core::engine::MetricValue| match x.value { Some(y) => format!("{y:.9}"), None => format!("null:{}:{}", x.validity, x.reason.clone().unwrap_or_default()) };
            println!("{}\t{:.1}\t{}\t{}\t{}\t{}", f.sequence, (mono - t0) as f64 / 1e6, fmt(&m.tna_raw), fmt(&m.focus_raw), fmt(&m.relaxation_raw), fmt(&m.emotion_raw));
        }
    }
    eprintln!("guard {:?}", core.guard_stats());
}
