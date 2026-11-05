//! SDD-314: 실기기 PPG 원문 패킷(.pkts: [u64 arrival_us][u32 len][bytes]...)을 코어에 재생해
//! 1초마다 HR/SDNN/RMSSD/호흡수/RR버퍼를 CSV 로 낸다. (진단 전용 example, 계약 무관)
use measurement_core::engine::{Core, CoreConfig, Emission, WallAnchor};
use measurement_core::parser::Sensor;

fn main() {
    let path = std::env::args().nth(1).expect("pkts file");
    let b = std::fs::read(path).unwrap();
    let mut core = Core::new(CoreConfig::default()).unwrap();
    let (mut o, mut first) = (0usize, None::<u64>);
    println!("t_s,hr,sdnn,rmssd,resp,resp_reason,rr_len,rr_n_new,rr_med");
    while o + 12 <= b.len() {
        let arr = u64::from_le_bytes(b[o..o + 8].try_into().unwrap());
        let len = u32::from_le_bytes(b[o + 8..o + 12].try_into().unwrap()) as usize;
        let pk = &b[o + 12..o + 12 + len];
        o += 12 + len;
        let f = *first.get_or_insert(arr);
        let out = core.push_packet(Sensor::Ppg, pk, arr, WallAnchor { wall_ms: arr / 1000, monotonic_us: arr });
        for e in out.emissions {
            if let Emission::Ppg(p) = e {
                let mut rr = p.result.rr.clone();
                rr.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let med = if rr.is_empty() { f64::NAN } else { rr[rr.len() / 2] };
                let s = |v: Option<f64>| v.map(|x| format!("{x:.2}")).unwrap_or_default();
                println!("{:.1},{},{},{},{},{},{},{},{:.0}", (arr - f) as f64 / 1e6, s(p.hrv.heart_rate), s(p.hrv.sdnn), s(p.hrv.rmssd),
                    s(p.hrv.respiratory_rate), p.resp_null_reason.clone().unwrap_or_default(), p.rr_buffer_len, p.result.rr.len(), med);
            }
        }
    }
}
