//! SDD-314: 짧은 RR(고심박)에서도 SDNN/호흡 시간조건이 열리는지, 갭·도약·이중피크에서 안전한지.
use measurement_core::dsp::hrv::HrvState;

const T0: f64 = 1_800_000_000_000.0;

/// bpm 고정(+선택적 RSA 변조)으로 `secs` 초 분량 박동을 한 박씩 먹인다. 마지막 스냅샷 반환.
fn run(bpm: f64, secs: f64, rsa_hz: f64, rsa_ms: f64, double_peak_every: usize) -> (HrvState, f64) {
    let mut s = HrvState::default();
    let base = 60000.0 / bpm;
    let (mut t, mut n) = (0.0f64, 0usize);
    while t < secs * 1000.0 {
        let rr = base + rsa_ms * (2.0 * std::f64::consts::PI * rsa_hz * t / 1000.0).sin();
        t += rr;
        n += 1;
        if double_peak_every > 0 && n % double_peak_every == 0 {
            // 가짜 이중 피크: 박동 하나를 (rr*0.4, rr*0.6) 두 개로 쪼갠다
            s.process_ppg(bpm, &[rr * 0.4], &[T0 + t - rr * 0.6], T0 + t - rr * 0.6);
            s.process_ppg(bpm, &[rr * 0.6], &[T0 + t], T0 + t);
        } else {
            s.process_ppg(bpm, &[rr], &[T0 + t], T0 + t);
        }
    }
    (s, t)
}

#[test]
fn sdnn_and_resp_open_for_60_to_180_bpm() {
    for bpm in [60.0, 90.0, 120.0, 150.0, 180.0] {
        let (s, _) = run(bpm, 240.0, 0.25, 30.0, 0);
        let snap = s.snapshot();
        let sdnn = snap.sdnn.unwrap_or_else(|| panic!("{bpm}bpm SDNN null"));
        assert!(sdnn < 40.0, "{bpm}bpm SDNN {sdnn} (RSA 30ms 기대 ≈21)");
        let r = snap.respiratory_rate.unwrap_or_else(|| panic!("{bpm}bpm 호흡 null: {:?}", s.resp_null_reason()));
        assert!((r - 15.0).abs() <= 2.0, "{bpm}bpm 호흡 {r} (기대 15±2)");
    }
}

#[test]
fn rr_buffer_is_bounded() {
    let (s, _) = run(180.0, 600.0, 0.25, 30.0, 0);
    assert!(s.rr_buffer_len() <= 400);
}

#[test]
fn double_peak_does_not_halve_median_rr() {
    // 5박마다 이중 피크(0.4/0.6 분할) — 중앙값 ±25% 필터가 쪼개진 RR 을 걸러내야 한다.
    let (s, _) = run(75.0, 240.0, 0.0, 0.0, 5);
    let avnn = s.snapshot().avnn.expect("avnn");
    assert!((avnn - 800.0).abs() <= 80.0, "avnn {avnn}");
}

#[test]
fn gap_and_clock_jump_recover_without_zero_fill() {
    let (mut s, t) = run(90.0, 120.0, 0.25, 30.0, 0);
    // 20초 갭 후 재개
    let mut tt = t + 20_000.0;
    for _ in 0..200 {
        tt += 666.0;
        s.process_ppg(90.0, &[666.0], &[T0 + tt], T0 + tt);
    }
    // 시각이 크게 과거로 도약(clock reset) 후 재개 — 패닉 없이 새 구간
    let mut t2 = 1000.0;
    for _ in 0..200 {
        t2 += 666.0;
        s.process_ppg(90.0, &[666.0], &[T0 + t2], T0 + tt + 1.0);
    }
    let snap = s.snapshot();
    if let Some(v) = snap.sdnn {
        assert!(v.is_finite() && v >= 0.0);
    }
    if let Some(v) = snap.respiratory_rate {
        assert!(v > 0.0, "호흡 0 치환 금지");
    }
}
