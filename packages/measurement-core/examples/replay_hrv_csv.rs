//! SDD-316: 웹 TS 와의 창별 일치 검증용. raw CSV(t,red,ir) 를 웹 하니스와 똑같이 50샘플마다·500샘플 링으로 PPG→HRV 에 넣는다.
//! (착용 판정·엔진 시계 없이 dsp 만 사용 — 웹 AnalysisMetricsService 와 동일 입력 조건)
use measurement_core::dsp::biquad::FilterImpl;
use measurement_core::dsp::hrv::HrvState;
use measurement_core::dsp::ppg::{self, PpgPoint};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (t0, t1): (f64, f64) = (a[2].parse().unwrap(), a[3].parse().unwrap());
    let text = std::fs::read_to_string(&a[1]).unwrap();
    let base = 1_800_000_000_000.0f64;
    let mut ring: Vec<PpgPoint> = Vec::new();
    let mut hrv = HrvState::default();
    let mut n = 0usize;
    println!("win,rr_len,sdnn,hr");
    for l in text.lines().skip(1) {
        let p: Vec<f64> = l.split(',').map(|x| x.parse().unwrap()).collect();
        if p[0] < t0 || p[0] >= t1 {
            continue;
        }
        let ts = base + (p[0] - t0) * 1000.0;
        ring.push(PpgPoint { ts, red: p[1], ir: p[2] });
        if ring.len() > 500 {
            ring.remove(0);
        }
        n += 1;
        if n % 50 == 0 {
            let res = ppg::analyze(&ring, FilterImpl::Biquad);
            hrv.process_ppg(res.heart_rate_raw, &res.rr, &res.rr_end_ts, ts);
            let s = hrv.snapshot();
            println!("{},{},{},{}", n / 50, hrv.rr_buffer_len(), s.sdnn.map(|x| format!("{x:.1}")).unwrap_or_default(), s.heart_rate.map(|x| format!("{x:.1}")).unwrap_or_default());
        }
    }
}
