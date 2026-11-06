//! SDD-316: .pkts(PPG 원문)를 코어에 재생해 프레임별 bpm/sdnn/rmssd/호흡 + validity/reason 을 CSV 로 낸다. (진단 전용)
use measurement_core::engine::{Core, CoreConfig, WallAnchor};
use measurement_core::parser::Sensor;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let b = std::fs::read(&a[1]).unwrap();
    // 선택 인자: 시작초 끝초 (패킷 도착 시각 기준 구간만 재생)
    let (t_from, t_to) = (a.get(2).and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0), a.get(3).and_then(|x| x.parse::<f64>().ok()).unwrap_or(f64::INFINITY));
    let t_base = u64::from_le_bytes(b[0..8].try_into().unwrap());
    let mut core = Core::new(CoreConfig::default()).unwrap();
    let (mut o, mut first) = (0usize, None::<u64>);
    println!("t_s,bpm,sdnn,rmssd,lf,resp,bpm_validity,bpm_reason,resp_reason");
    while o + 12 <= b.len() {
        let arr = u64::from_le_bytes(b[o..o + 8].try_into().unwrap());
        let len = u32::from_le_bytes(b[o + 8..o + 12].try_into().unwrap()) as usize;
        let pk = &b[o + 12..o + 12 + len];
        o += 12 + len;
        let rel = (arr - t_base) as f64 / 1e6;
        if rel < t_from || rel >= t_to {
            continue;
        }
        let f = *first.get_or_insert(arr);
        let out = core.push_packet(Sensor::Ppg, pk, arr, WallAnchor { wall_ms: arr / 1000, monotonic_us: arr });
        if std::env::var("WEAR_DBG").is_ok() {
            for e in &out.emissions {
                if let measurement_core::engine::Emission::Ppg(p) = e {
                    eprintln!("{:.1},{},{},{},{},{}", (arr - f) as f64 / 1e6, p.rr_buffer_len, p.hrv.avnn.map(|x| x.to_string()).unwrap_or_default(), p.hrv.sdnn.map(|x| x.to_string()).unwrap_or_default(), p.hrv.heart_rate.map(|x| x.to_string()).unwrap_or_default(), p.result.heart_rate_raw);
                }
            }
        }
        for fr in out.frames {
            let m = &fr.metrics;
            let s = |v: Option<f64>| v.map(|x| format!("{x:.2}")).unwrap_or_default();
            println!("{:.1},{},{},{},{},{},{},{},{}", (arr - f) as f64 / 1e6, s(m.bpm.value), s(m.sdnn.value), s(m.rmssd.value), s(m.lf_power.value), s(m.respiration.value),
                m.bpm.validity, m.bpm.reason.clone().unwrap_or_default(), m.respiration.reason.clone().unwrap_or_default());
        }
    }
}
