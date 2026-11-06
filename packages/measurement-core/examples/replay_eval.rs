//! SDD-317: 정확도 하네스용 얇은 재생 example (코어 src 무수정, 호출만).
//! 입력 .pkts: [u64 arrival_us][u32 len][bytes]... (replay_wear 와 동일 형식). PPG 패킷만 먹인다.
//! 출력(stdout CSV, 패킷마다 emission 1줄):
//!   k,arr_us,win_end_ts,hr,sdnn,rmssd,resp,resp_reason,rr_buf,heart_rate_raw,rr_list,rr_end_ts_list
//! rr_list/rr_end_ts_list 는 ';' 구분(해당 분석창의 후보 RR 과 닫는 피크의 웹 타임라인 ms). 값 없음=빈 칸.
use measurement_core::engine::{Core, CoreConfig, Emission, WallAnchor};
use measurement_core::parser::Sensor;

fn main() {
    let path = std::env::args().nth(1).expect("pkts file");
    let b = std::fs::read(path).unwrap();
    let mut core = Core::new(CoreConfig::default()).unwrap();
    let mut o = 0usize;
    let mut k = 0u64;
    println!("k,arr_us,win_end_ts,hr,sdnn,rmssd,resp,resp_reason,rr_buf,heart_rate_raw,rr_list,rr_end_ts_list");
    while o + 12 <= b.len() {
        let arr = u64::from_le_bytes(b[o..o + 8].try_into().unwrap());
        let len = u32::from_le_bytes(b[o + 8..o + 12].try_into().unwrap()) as usize;
        let pk = &b[o + 12..o + 12 + len];
        o += 12 + len;
        let out = core.push_packet(Sensor::Ppg, pk, arr, WallAnchor { wall_ms: arr / 1000, monotonic_us: arr });
        for e in out.emissions {
            if let Emission::Ppg(p) = e {
                let s = |v: Option<f64>| v.map(|x| format!("{x:.6}")).unwrap_or_default();
                let j = |v: &Vec<f64>| v.iter().map(|x| format!("{x:.3}")).collect::<Vec<_>>().join(";");
                println!(
                    "{},{},{:.3},{},{},{},{},{},{},{:.3},{},{}",
                    k,
                    arr,
                    p.window_end_ts,
                    s(p.hrv.heart_rate),
                    s(p.hrv.sdnn),
                    s(p.hrv.rmssd),
                    s(p.hrv.respiratory_rate),
                    p.resp_null_reason.clone().unwrap_or_default(),
                    p.rr_buffer_len,
                    p.result.heart_rate_raw,
                    j(&p.result.rr),
                    j(&p.result.rr_end_ts)
                );
            }
        }
        k += 1;
    }
}
