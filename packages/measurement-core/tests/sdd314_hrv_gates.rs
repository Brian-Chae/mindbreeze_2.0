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

/// [성질 검사] 수정 전 값(62s)에서도 통과한다 — 이 합성 입력으로는 실데이터의 연쇄 탈락이 재현되지 않는다. 회귀 검출은 실데이터 replay 로 한다.
/// 실데이터형: Android 실측 RR 분포(300~1300ms 에 넓게 퍼짐, 히스토그램 100ms 단위)에서 독립 추출하면 중앙값 ±25% 정리가
/// 박동의 절반 이상을 걷어낸다. 호흡 버퍼 목표가 게이트(60s) 직상이면 버퍼 합이 게이트 밑으로 내려가 호흡이 꺼졌다.
#[test]
fn resp_stays_open_with_wide_rr_distribution() {
    // (구간 시작 ms, 가중치) — 62c5fe4b 실측 히스토그램 일부
    let hist: [(f64, u64); 11] = [(300.0, 1081), (400.0, 745), (500.0, 593), (600.0, 379), (700.0, 255), (800.0, 138), (900.0, 106), (1000.0, 135), (1100.0, 17), (1200.0, 128), (1300.0, 50)];
    let total_w: u64 = hist.iter().map(|h| h.1).sum();
    let mut s = HrvState::default();
    let (mut t, mut seed) = (0.0f64, 7u64);
    let (mut valid, mut total) = (0usize, 0usize);
    while t < 900_000.0 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let mut pick = (seed >> 33) % total_w;
        let mut rr = 300.0;
        for (lo, w) in hist {
            if pick < w {
                rr = lo + ((seed >> 20) % 100) as f64;
                break;
            }
            pick -= w;
        }
        t += rr;
        s.process_ppg(90.0, &[rr], &[T0 + t], T0 + t);
        if t > 300_000.0 {
            total += 1;
            if s.snapshot().respiratory_rate.is_some() {
                valid += 1;
            }
        }
    }
    assert!(valid as f64 / total as f64 >= 0.9, "호흡 유효 비율 {valid}/{total}");
}

// ---- SDD-316: 중앙값 ±25% 게이트 락인 재시드 ----

/// 앞 `fake_n` 개 가짜 짧은 RR(380ms) 뒤 진짜 700ms 박동. 재시드로 정상 RR 로 전환되고 SDNN 이 나오는지.
#[test]
fn sdd316_reseed_recovers_from_poisoned_buffer() {
    let mut s = HrvState::default();
    let mut t = 0.0f64;
    for _ in 0..13 {
        t += 380.0;
        s.process_ppg(80.0, &[380.0], &[T0 + t], T0 + t);
    }
    for _ in 0..200 {
        t += 700.0;
        s.process_ppg(85.0, &[700.0], &[T0 + t], T0 + t);
    }
    let snap = s.snapshot();
    let avnn = snap.avnn.expect("재시드 후 avnn");
    assert!((avnn - 700.0).abs() < 30.0, "avnn {avnn}");
    assert!(snap.sdnn.is_some());
}

/// 재시드까지 걸리는 연속 탈락 창 수는 RR_GATE_RESEED_STREAK(12) 근처.
#[test]
fn sdd316_reseed_not_before_streak() {
    use measurement_core::dsp::hrv::RR_GATE_RESEED_STREAK;
    let mut s = HrvState::default();
    let mut t = 0.0f64;
    for _ in 0..13 {
        t += 380.0;
        s.process_ppg(80.0, &[380.0], &[T0 + t], T0 + t);
    }
    let before = s.rr_buffer_len();
    for _ in 0..(RR_GATE_RESEED_STREAK - 1) {
        t += 700.0;
        s.process_ppg(85.0, &[700.0], &[T0 + t], T0 + t);
    }
    assert!(s.rr_buffer_len() >= before.min(5), "스트릭 미달인데 비워짐");
}

/// 부정맥형: 정상 800ms 사이에 불규칙 RR(±25% 밖)이 섞여도(연속 12창 전부 탈락하지 않음) 재시드·버퍼 비움이 없다.
#[test]
fn sdd316_arrhythmia_does_not_trigger_reseed() {
    let mut s = HrvState::default();
    let mut t = 0.0f64;
    let mut state = 12345u64;
    let mut rnd = || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (state >> 33) as f64 / (1u64 << 31) as f64
    };
    let mut min_len_after_warm = usize::MAX;
    for i in 0..400 {
        // 4박 중 1박 꼴로 크게 벗어난 RR(500 또는 1100ms), 나머지는 800±40
        let rr = if rnd() < 0.25 { if rnd() < 0.5 { 500.0 } else { 1100.0 } } else { 800.0 + (rnd() - 0.5) * 80.0 };
        t += rr;
        s.process_ppg(75.0, &[rr], &[T0 + t], T0 + t);
        if i > 60 {
            min_len_after_warm = min_len_after_warm.min(s.rr_buffer_len());
        }
    }
    assert!(min_len_after_warm >= 30, "부정맥 입력에서 버퍼가 비워짐: {min_len_after_warm}");
    assert!(s.snapshot().sdnn.is_some());
}

/// 지속적으로 완전 불규칙(균등 300~1500ms)인 경우: 재시드가 끊임없이 일어나도 panic/0 치환 없음.
#[test]
fn sdd316_fully_random_rr_is_safe() {
    let mut s = HrvState::default();
    let (mut t, mut state) = (0.0f64, 99u64);
    for _ in 0..600 {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let rr = 300.0 + ((state >> 33) as f64 / (1u64 << 31) as f64) * 1200.0;
        t += rr;
        s.process_ppg(75.0, &[rr], &[T0 + t], T0 + t);
        if let Some(v) = s.snapshot().sdnn {
            assert!(v.is_finite() && v > 0.0);
        }
    }
}
