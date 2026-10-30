//! 엔진 불변식: batch 크기 불변, checkpoint/restore 동치, null≠0, config 검증, 손상 checkpoint 거절.
//! 입력은 T01 synth 와 무관한 결정적 합성(샘플 인덱스의 순수 함수)이다.

mod common;
use measurement_core::engine::{Core, CoreConfig, MetricFrame, ModelMode, WallAnchor};
use measurement_core::parser::Sensor;

const WALL0_MS: u64 = 1_760_000_000_000;
const ANCHOR: WallAnchor = WallAnchor { wall_ms: WALL0_MS, monotonic_us: 0 };

struct Lcg(u64);
impl Lcg {
    fn noise(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 32) as f64 / 2147483648.0) - 1.0
    }
}

fn gen_eeg_raw(n: usize) -> Vec<(i32, i32, u8)> {
    let mut r = Lcg(7);
    let tau = std::f64::consts::TAU;
    let lsb = 4.033 / 12.0 / 8388607.0 * 1e6;
    (0..n)
        .map(|k| {
            let t = k as f64 / 250.0;
            let a = 18.0 * (tau * 10.0 * t).sin() + 6.0 * (tau * 20.0 * t).sin() + 4.0 * r.noise();
            let b = 15.0 * (tau * 10.0 * t + 1.0).sin() + 5.0 * (tau * 6.0 * t).sin() + 4.0 * r.noise();
            ((a / lsb).round() as i32, (b / lsb).round() as i32, if k % 777 == 0 { 4 } else { 0 })
        })
        .collect()
}

fn gen_ppg_raw(n: usize) -> Vec<(u32, u32)> {
    let mut r = Lcg(11);
    let tau = std::f64::consts::TAU;
    let mut phi = 0.0;
    (0..n)
        .map(|k| {
            let t = k as f64 / 50.0;
            phi += (72.0 + 6.0 * (tau * 0.25 * t).sin()) / 60.0 / 50.0;
            let p = (tau * phi).sin() + 0.3 * (2.0 * tau * phi).sin();
            ((90_000.0 + 1800.0 * p + 30.0 * r.noise()).round() as u32, (120_000.0 + 2500.0 * p + 30.0 * r.noise()).round() as u32)
        })
        .collect()
}

fn eeg_pkt(raw: &[(i32, i32, u8)], end_idx: usize) -> Vec<u8> {
    let tick = ((end_idx as f64) * 32768.0 / 250.0).round() as u32;
    let mut b = tick.to_le_bytes().to_vec();
    for &(a, c, lo) in raw {
        b.push(lo);
        b.extend_from_slice(&(a as u32).to_be_bytes()[1..4]);
        b.extend_from_slice(&(c as u32).to_be_bytes()[1..4]);
    }
    b
}
fn ppg_pkt(raw: &[(u32, u32)], end_idx: usize) -> Vec<u8> {
    let tick = ((end_idx as f64) * 32768.0 / 50.0).round() as u32;
    let mut b = tick.to_le_bytes().to_vec();
    for &(r, i) in raw {
        b.extend_from_slice(&r.to_be_bytes()[1..4]);
        b.extend_from_slice(&i.to_be_bytes()[1..4]);
    }
    b
}

/// 샘플 인덱스의 순수 함수로 도착 시각을 정한다 → 어떤 batch 로 나눠도 같은 시간축.
fn run(core: &mut Core, eeg: &[(i32, i32, u8)], ppg: &[(u32, u32)], en: usize, pn: usize, from: (usize, usize)) -> Vec<MetricFrame> {
    let mut frames = Vec::new();
    let (mut e, mut p) = from;
    while e < eeg.len() || p < ppg.len() {
        let e_end = (e + en).min(eeg.len());
        let p_end = (p + pn).min(ppg.len());
        let e_t = if e < eeg.len() { e_end as f64 * 4_000.0 } else { f64::INFINITY };
        let p_t = if p < ppg.len() { p_end as f64 * 20_000.0 } else { f64::INFINITY };
        if e_t <= p_t {
            let arr = (e_end as u64) * 4_000;
            frames.extend(core.push_packet(Sensor::Eeg, &eeg_pkt(&eeg[e..e_end], e_end), arr, ANCHOR).frames);
            e = e_end;
        } else {
            let arr = (p_end as u64) * 20_000;
            frames.extend(core.push_packet(Sensor::Ppg, &ppg_pkt(&ppg[p..p_end], p_end), arr, ANCHOR).frames);
            p = p_end;
        }
    }
    frames
}

/// 시간 필드는 sub-ms 반올림 영향을 배제하고 값 필드를 비교한다(값은 비트 단위 동일해야 함).
fn values(frames: &[MetricFrame]) -> Vec<String> {
    frames
        .iter()
        .map(|f| {
            let mut v = serde_json::to_value(f).unwrap();
            let o = v.as_object_mut().unwrap();
            for k in ["window_start_us", "window_end_us", "observed_at_ms", "feature_hash"] {
                o.remove(k);
            }
            for m in o["metrics"].as_object_mut().unwrap().values_mut() {
                let mo = m.as_object_mut().unwrap();
                mo.remove("last_valid_observed_at_ms");
            }
            v.to_string()
        })
        .collect()
}

fn first_diff(a: &[String], b: &[String]) -> Option<String> {
    if a.len() != b.len() {
        return Some(format!("frame 수 {} vs {}", a.len(), b.len()));
    }
    for (i, (x, y)) in a.iter().zip(b).enumerate() {
        if x != y {
            let (vx, vy): (serde_json::Value, serde_json::Value) = (serde_json::from_str(x).unwrap(), serde_json::from_str(y).unwrap());
            let mut d = vec![];
            for (k, m) in vx["metrics"].as_object().unwrap() {
                if m != &vy["metrics"][k] {
                    d.push(format!("{k}: {} vs {}", m["value"], vy["metrics"][k]["value"]));
                }
            }
            return Some(format!("frame[{i}] seq={} 차이: {:?} sqi {} vs {}", vx["sequence"], d, vx["sqi"], vy["sqi"]));
        }
    }
    None
}

fn data() -> (Vec<(i32, i32, u8)>, Vec<(u32, u32)>) {
    (gen_eeg_raw(250 * 100), gen_ppg_raw(50 * 100))
}

#[test]
fn batch_size_does_not_change_output() {
    let (eeg, ppg) = data();
    let go = |en, pn| {
        let mut c = Core::new(CoreConfig::default()).unwrap();
        run(&mut c, &eeg, &ppg, en, pn, (0, 0))
    };
    let a = go(25, 5);
    assert!(a.len() >= 90, "프레임 수 부족: {}", a.len());
    // 값이 모두 null 이 아니어야 비교가 의미 있다
    assert!(a.iter().any(|f| f.metrics.sdnn.value.is_some()) && a.iter().any(|f| f.metrics.respiration.value.is_some()) && a.iter().any(|f| f.metrics.focus_raw.value.is_some()));
    for (en, pn) in [(10, 5), (7, 3), (50, 50), (1, 1)] {
        let b = go(en, pn);
        if let Some(d) = first_diff(&values(&a), &values(&b)) {
            panic!("batch {en}/{pn} 출력이 25/5 와 다름: {d}");
        }
    }
}

/// 전역 도착 스케줄(센서 인터리브 고정) — 어디서 잘라도 같은 순서.
fn schedule(eeg: &[(i32, i32, u8)], ppg: &[(u32, u32)], en: usize, pn: usize) -> Vec<(Sensor, Vec<u8>, u64)> {
    let mut v = Vec::new();
    let (mut e, mut p) = (0usize, 0usize);
    while e < eeg.len() || p < ppg.len() {
        let e_end = (e + en).min(eeg.len());
        let p_end = (p + pn).min(ppg.len());
        let e_t = if e < eeg.len() { e_end as f64 * 4_000.0 } else { f64::INFINITY };
        let p_t = if p < ppg.len() { p_end as f64 * 20_000.0 } else { f64::INFINITY };
        if e_t <= p_t {
            v.push((Sensor::Eeg, eeg_pkt(&eeg[e..e_end], e_end), e_end as u64 * 4_000));
            e = e_end;
        } else {
            v.push((Sensor::Ppg, ppg_pkt(&ppg[p..p_end], p_end), p_end as u64 * 20_000));
            p = p_end;
        }
    }
    v
}

#[test]
fn checkpoint_restore_equals_straight_through() {
    let (eeg, ppg) = data();
    let cfg = CoreConfig::default();
    let sched = schedule(&eeg, &ppg, 25, 5);
    let mut full = Core::new(cfg.clone()).unwrap();
    let mut straight = Vec::new();
    for (s, b, t) in &sched {
        straight.extend(full.push_packet(*s, b, *t, ANCHOR).frames);
    }
    assert!(straight.iter().any(|f| f.metrics.respiration.value.is_some()), "호흡 값이 이미 나온 구간을 지나야 의미 있음");

    // 여러 지점(윈도·호흡 warm-up 전/중/후)에서 저장→복원
    for cut in [37usize, sched.len() / 3 + 1, sched.len() / 2 + 3, sched.len() * 4 / 5 + 2] {
        let mut a = Core::new(cfg.clone()).unwrap();
        let mut got = Vec::new();
        for (s, b, t) in &sched[..cut] {
            got.extend(a.push_packet(*s, b, *t, ANCHOR).frames);
        }
        let ck = a.checkpoint();
        drop(a);
        let mut r = Core::restore(cfg.clone(), &ck).unwrap();
        for (s, b, t) in &sched[cut..] {
            got.extend(r.push_packet(*s, b, *t, ANCHOR).frames);
        }
        assert_eq!(serde_json::to_string(&straight).unwrap(), serde_json::to_string(&got).unwrap(), "cut={cut}: restore 뒤 출력 상이");
        let (f, g) = (full.close(), r.close());
        assert_eq!((f.final_sequences.metric.clone(), f.raw_sha256.clone(), f.feature_sha256.clone()), (g.final_sequences.metric.clone(), g.raw_sha256.clone(), g.feature_sha256.clone()), "cut={cut}");
    }
}

#[test]
fn restore_rejects_corrupt_wrong_config_and_garbage() {
    let cfg = CoreConfig::default();
    let core = Core::new(cfg.clone()).unwrap();
    let ck = core.checkpoint();
    assert!(Core::restore(cfg.clone(), &ck).is_ok());
    let mut bad = ck.clone();
    let m = bad.len() / 2;
    bad[m] ^= 0xff;
    assert!(Core::restore(cfg.clone(), &bad).is_err());
    assert!(Core::restore(cfg.clone(), b"nope").is_err());
    assert!(Core::restore(cfg.clone(), &ck[..ck.len() - 1]).is_err());
    let other = CoreConfig { algorithm_version: "web-ts-2".into(), ..cfg.clone() };
    assert!(Core::restore(other, &ck).is_err(), "다른 algorithm_version 의 checkpoint 를 받으면 안 됨");
    let other_model = CoreConfig { model_hash: "b".repeat(64), ..cfg };
    assert!(Core::restore(other_model, &ck).is_err());
}

#[test]
fn config_validation_rejects_unsupported_profile() {
    let ok = CoreConfig::default();
    assert!(ok.validate().is_ok());
    assert!(CoreConfig { abi_version: 2, ..ok.clone() }.validate().is_err());
    assert!(CoreConfig { anchor: "first_sample_sdk".into(), ..ok.clone() }.validate().is_err());
    assert!(CoreConfig { acc_interval_profile: "rational".into(), ..ok.clone() }.validate().is_err());
    assert!(CoreConfig { model_hash: "XYZ".into(), ..ok.clone() }.validate().is_err());
    assert!(Core::new(CoreConfig { abi_version: 9, ..ok }).is_err());
}

#[test]
fn null_is_never_replaced_by_zero_and_warming_up_is_explicit() {
    let ppg = gen_ppg_raw(50 * 8);
    let mut c = Core::new(CoreConfig::default()).unwrap();
    let mut frames = Vec::new();
    for (i, ch) in ppg.chunks(5).enumerate() {
        let end = (i + 1) * 5;
        frames.extend(c.push_packet(Sensor::Ppg, &ppg_pkt(ch, end), end as u64 * 20_000, ANCHOR).frames);
    }
    let f = frames.last().expect("PPG 프레임");
    for m in [&f.metrics.sdnn, &f.metrics.respiration] {
        assert_eq!(m.value, None);
        assert_eq!(m.validity, "warming_up");
        assert!(m.reason.is_some());
    }
    // EEG 가 한 번도 없었으면 EEG 계열도 null/warming_up, 0 이 아님
    assert_eq!(f.metrics.focus_raw.value, None);
    assert_eq!(f.metrics.focus_display.value, None);
    assert_eq!(f.contact.fp1, "unknown");
    assert_eq!(f.sqi, None);
}

#[test]
fn active_sigmoid_without_model_is_invalid_not_cohort_fallback() {
    // active_sigmoid 인데 모델 params 가 없으면 코호트 점수로 몰래 대체하지 않는다(이중 정규화·혼용 금지)
    let (eeg, ppg) = data();
    let mut c = Core::new(CoreConfig { model_mode: ModelMode::ActiveSigmoid, ..CoreConfig::default() }).unwrap();
    let frames = run(&mut c, &eeg[..250 * 12], &ppg[..50 * 12], 25, 5, (0, 0));
    let f = frames.iter().rev().find(|f| f.metrics.focus_raw.value.is_some()).expect("EEG 가 나온 프레임");
    assert_eq!(f.metrics.focus_display.value, None);
    assert_eq!(f.metrics.focus_display.validity, "invalid");
    assert_eq!(f.metrics.focus_display.reason.as_deref(), Some("model_unavailable"));
}

#[test]
fn contact_is_independent_from_sqi() {
    // 양 채널 leadoff 이면 contact=leadoff, 두 지표는 별개 필드
    let n = 250 * 6;
    let eeg: Vec<(i32, i32, u8)> = gen_eeg_raw(n).into_iter().map(|(a, b, _)| (a, b, 5)).collect();
    let mut c = Core::new(CoreConfig::default()).unwrap();
    let mut frames = Vec::new();
    for (i, ch) in eeg.chunks(25).enumerate() {
        let end = (i + 1) * 25;
        frames.extend(c.push_packet(Sensor::Eeg, &eeg_pkt(ch, end), end as u64 * 4_000, ANCHOR).frames);
    }
    let f = frames.last().expect("프레임");
    assert_eq!((f.contact.fp1, f.contact.fp2), ("leadoff", "leadoff"));
    assert_eq!(f.metrics.focus_raw.validity, "invalid");
    assert_eq!(f.metrics.focus_raw.reason.as_deref(), Some("leadoff"));
}

#[test]
fn advance_emits_single_gap_frame_after_silence() {
    let (eeg, ppg) = data();
    let mut c = Core::new(CoreConfig::default()).unwrap();
    let frames = run(&mut c, &eeg[..250 * 8], &ppg[..50 * 8], 25, 5, (0, 0));
    assert!(!frames.is_empty());
    let last_arr = 8_000_000u64;
    assert!(c.advance(last_arr + 1_000_000).is_empty(), "3초 미만은 gap 프레임 없음");
    let g = c.advance(last_arr + 4_000_000);
    assert_eq!(g.len(), 1);
    assert_eq!(g[0].metrics.bpm.validity, "gap");
    assert_eq!(g[0].metrics.focus_raw.validity, "gap");
    assert!(c.advance(last_arr + 9_000_000).is_empty(), "같은 공백에서 gap 프레임을 반복하지 않음");
}

#[test]
fn tna_raw_is_emitted_as_index_raw() {
    let (eeg, ppg) = data();
    let mut c = Core::new(CoreConfig::default()).unwrap();
    let a = run(&mut c, &eeg, &ppg, 25, 5, (0, 0));
    let valid: Vec<_> = a.iter().filter(|f| f.metrics.tna_raw.value.is_some()).collect();
    assert!(!valid.is_empty(), "tna_raw 가 한 번도 valid 가 아님");
    for f in &valid {
        assert_eq!(f.metrics.tna_raw.unit, "index_raw");
        assert_eq!(f.metrics.tna_raw.validity, "valid");
        assert!(f.metrics.tna_raw.value.unwrap().is_finite());
    }
    // 워밍업 구간은 null (0 치환 금지)
    assert!(a.iter().any(|f| f.metrics.tna_raw.value.is_none()));
}

#[test]
fn extended_feature_metrics_are_emitted_with_v1_units() {
    let (eeg, ppg) = data();
    let mut c = Core::new(CoreConfig::default()).unwrap();
    let a = run(&mut c, &eeg, &ppg, 25, 5, (0, 0));
    // 밴드파워·total_power: 단위 power_raw, total = 5밴드 합(독립 계산), 워밍업은 null
    let v: Vec<_> = a.iter().filter(|f| f.metrics.total_power.value.is_some()).collect();
    assert!(!v.is_empty(), "total_power 가 한 번도 valid 가 아님");
    for f in &v {
        let m = &f.metrics;
        for x in [&m.delta_power, &m.theta_power, &m.alpha_power, &m.beta_power, &m.gamma_power, &m.total_power] {
            assert_eq!((x.unit, x.validity), ("power_raw", "valid"));
        }
        let sum = m.delta_power.value.unwrap() + m.theta_power.value.unwrap() + m.alpha_power.value.unwrap() + m.beta_power.value.unwrap() + m.gamma_power.value.unwrap();
        assert!((sum - m.total_power.value.unwrap()).abs() < 1e-9, "total_power != 5밴드 합");
        // v1 정의 대조: focus = beta/(alpha+theta+eps), stress = (beta+gamma)/(alpha+theta+eps), cognitive_load = theta/(alpha+eps)
        let (al, be, th, ga) = (m.alpha_power.value.unwrap(), m.beta_power.value.unwrap(), m.theta_power.value.unwrap(), m.gamma_power.value.unwrap());
        let close = |a: f64, b: f64| (a - b).abs() <= 1e-6 * (1.0 + b.abs());
        assert!(close(m.stress_index.value.unwrap(), (be + ga) / (al + th + 1e-10)), "stress");
        assert!(close(m.cognitive_load.value.unwrap(), th / (al + 1e-10)), "cognitive_load");
        assert!(close(m.focus_raw.value.unwrap(), be / (al + th + 1e-10)), "focus");
        assert_eq!(m.stress_index.unit, "index_raw");
        assert_eq!(m.cognitive_load.unit, "index_raw");
        assert_eq!(m.hemispheric_balance.unit, "index_raw");
        assert!(m.hemispheric_balance.value.unwrap().abs() <= 1.0);
        // FAA 는 값이 없으면 null+사유(0 치환 금지)
        match m.faa.value {
            Some(x) => assert!(x.is_finite()),
            None => assert_eq!(m.faa.reason.as_deref(), Some("faa_unavailable")),
        }
    }
    // HRV: 단위, 값이 나온 프레임에서 rmssd/lf/hf/ratio 도 계약 단위
    for f in &a {
        let m = &f.metrics;
        assert_eq!(m.rmssd.unit, "ms");
        assert_eq!(m.lf_power.unit, "power_raw");
        assert_eq!(m.hf_power.unit, "power_raw");
        assert_eq!(m.lf_hf_ratio.unit, "index_raw");
        assert_eq!(m.motion.unit, "ratio_0_1");
        for x in [&m.rmssd, &m.lf_power, &m.hf_power, &m.lf_hf_ratio, &m.motion] {
            if x.validity != "valid" { assert!(x.value.is_none(), "null 이어야 함(0 치환 금지)"); }
        }
    }
    // 워밍업 구간은 null
    assert!(a.iter().any(|f| f.metrics.total_power.value.is_none()));
    // 직렬화 키 확인: 신규 15키가 프레임 JSON 에 모두 존재
    let j = serde_json::to_value(&a.last().unwrap().metrics).unwrap();
    for k in ["delta_power","theta_power","alpha_power","beta_power","gamma_power","total_power","stress_index","cognitive_load","faa","hemispheric_balance","rmssd","lf_power","hf_power","lf_hf_ratio","motion"] {
        assert!(j.get(k).is_some(), "{k} 누락");
    }
}
