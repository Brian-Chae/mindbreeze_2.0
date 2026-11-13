//! 저장값 재산출용(SDD fix-rmssd): 연속 구간 PPG 원시 샘플을 표준입력으로 받아 서비스와 같은 방식으로 재생한다.
//! 입력(stdin, 줄 단위): `ts_ms,red,ir` — 50Hz 연속 구간 하나(구간이 끊기면 호출자가 프로세스를 새로 띄운다).
//! 동작: 500샘플 링버퍼 + 50샘플(1초)마다 `ppg::analyze` → `HrvState::process_ppg` (web 하니스·replay_hrv_csv 와 동일 조건).
//! 출력(stdout): `ts_ms,rmssd,sdnn,lf_power,hf_power,lf_hf_ratio,heart_rate` — 값이 없으면 빈 칸.
use measurement_core::dsp::biquad::FilterImpl;
use measurement_core::dsp::hrv::HrvState;
use measurement_core::dsp::ppg::{self, PpgPoint};
use std::io::{BufRead, Write};

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    let mut ring: Vec<PpgPoint> = Vec::new();
    let mut hrv = HrvState::default();
    let mut n = 0usize;
    writeln!(out, "ts_ms,rmssd,sdnn,lf_power,hf_power,lf_hf_ratio,heart_rate").unwrap();
    let f = |v: Option<f64>| v.map(|x| format!("{x:.6}")).unwrap_or_default();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let mut it = line.split(',');
        let (Some(a), Some(b), Some(c)) = (it.next(), it.next(), it.next()) else { continue };
        let (Ok(ts), Ok(red), Ok(ir)) = (a.trim().parse::<f64>(), b.trim().parse::<f64>(), c.trim().parse::<f64>()) else { continue };
        ring.push(PpgPoint { ts, red, ir });
        if ring.len() > 500 {
            ring.remove(0);
        }
        n += 1;
        if n % 50 == 0 && ring.len() >= 50 {
            let res = ppg::analyze(&ring, FilterImpl::Biquad);
            hrv.process_ppg(res.heart_rate_raw, &res.rr, &res.rr_end_ts, ts);
            let s = hrv.snapshot();
            writeln!(out, "{},{},{},{},{},{},{}", ts, f(s.rmssd), f(s.sdnn), f(s.lf_power), f(s.hf_power), f(s.lf_hf_ratio), f(s.heart_rate)).unwrap();
        }
    }
}
