//! SDD-316: PPG 직류 레벨 기반 미착용 판정 — 합성 시험(착용→미착용→착용, 히스테리시스, 버퍼 비움).
use measurement_core::engine::{Core, CoreConfig, MetricFrame, WallAnchor};
use measurement_core::parser::Sensor;

const ANCHOR: WallAnchor = WallAnchor { wall_ms: 1_760_000_000_000, monotonic_us: 0 };

#[derive(Clone, Copy)]
enum Seg {
    /// 착용: IR 직류 1.4M + 맥파(bpm, RSA 변조)
    Worn(f64),
    /// 미착용: IR 직류 dc + 잡음만(평탄)
    Off(f64),
}

fn gen(segs: &[(Seg, f64)]) -> Vec<(u32, u32)> {
    let tau = std::f64::consts::TAU;
    let mut out = Vec::new();
    let mut phi = 0.0;
    let mut seed = 5u64;
    let mut noise = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((seed >> 32) as f64 / 2147483648.0) - 1.0
    };
    let mut k = 0usize;
    for &(seg, secs) in segs {
        for _ in 0..(secs * 50.0) as usize {
            let t = k as f64 / 50.0;
            let (red, ir) = match seg {
                Seg::Worn(bpm) => {
                    phi += (bpm + 4.0 * (tau * 0.25 * t).sin()) / 60.0 / 50.0;
                    let p = (tau * phi).sin() + 0.3 * (2.0 * tau * phi).sin();
                    (1_300_000.0 + 3000.0 * p + 40.0 * noise(), 1_420_000.0 + 4000.0 * p + 40.0 * noise())
                }
                Seg::Off(dc) => (dc * 0.7 + 8.0 * noise(), dc + 8.0 * noise()),
            };
            out.push((red.round() as u32, ir.round() as u32));
            k += 1;
        }
    }
    out
}

fn pkt(raw: &[(u32, u32)], end_idx: usize) -> Vec<u8> {
    let tick = ((end_idx as f64) * 32768.0 / 50.0).round() as u32;
    let mut b = tick.to_le_bytes().to_vec();
    for &(r, i) in raw {
        b.extend_from_slice(&r.to_be_bytes()[1..4]);
        b.extend_from_slice(&i.to_be_bytes()[1..4]);
    }
    b
}

/// batch 크기 `pn` 으로 먹이며 (프레임, 초별 RR 버퍼 길이는 알 수 없으므로 emission 의 rr_buffer_len) 수집
fn run(ppg: &[(u32, u32)], pn: usize) -> (Vec<MetricFrame>, Vec<usize>) {
    let mut core = Core::new(CoreConfig::default()).unwrap();
    let (mut frames, mut rrlen) = (Vec::new(), Vec::new());
    let mut p = 0;
    while p < ppg.len() {
        let end = (p + pn).min(ppg.len());
        let out = core.push_packet(Sensor::Ppg, &pkt(&ppg[p..end], end), (end as u64) * 20_000, ANCHOR);
        frames.extend(out.frames);
        for e in out.emissions {
            if let measurement_core::engine::Emission::Ppg(pe) = e {
                rrlen.push(pe.rr_buffer_len);
            }
        }
        p = end;
    }
    (frames, rrlen)
}

fn pm(f: &MetricFrame) -> [&measurement_core::engine::MetricValue; 6] {
    let m = &f.metrics;
    [&m.bpm, &m.sdnn, &m.rmssd, &m.lf_power, &m.hf_power, &m.respiration]
}
fn frame_at(frames: &[MetricFrame], sec: f64) -> &MetricFrame {
    frames.iter().min_by_key(|f| ((f.window_end_us.parse::<f64>().unwrap() / 1e6 - sec).abs() * 1e3) as u64).unwrap()
}
fn t0(frames: &[MetricFrame]) -> f64 {
    frames[0].window_end_us.parse::<f64>().unwrap() / 1e6
}
fn all_not_worn(f: &MetricFrame) -> bool {
    pm(f).iter().all(|v| v.value.is_none() && v.validity == "invalid" && v.reason.as_deref() == Some("not_worn"))
}

#[test]
fn worn_off_worn_sequence() {
    // 착용 90초 → 미착용 30초 → 착용 120초
    let ppg = gen(&[(Seg::Worn(75.0), 90.0), (Seg::Off(5_000.0), 30.0), (Seg::Worn(75.0), 120.0)]);
    let (frames, _) = run(&ppg, 25);
    let base = t0(&frames);
    // V1-1: 착용 후반 값 있음
    let f = frame_at(&frames, base + 80.0);
    assert!(f.metrics.bpm.value.is_some() && f.metrics.sdnn.value.is_some(), "착용 구간 값 없음: {:?}", f.metrics.bpm);
    assert!(f.metrics.bpm.reason.is_none());
    // V1-2: 진입 3초 유예 안(미착용 시작 후 ~1.5초)엔 아직 not_worn 아님
    let early = frame_at(&frames, base + 90.0 + 1.5 - 1.0);
    assert!(!all_not_worn(early), "유예 중 깜빡임");
    // V1-3: 미착용 5초 이후 ~ 29초 전부 null+not_worn, 0 치환 없음
    for s in 6..29 {
        let f = frame_at(&frames, base + 90.0 + s as f64);
        assert!(all_not_worn(f), "미착용 {s}s: {:?}", pm(f).map(|v| (v.value, v.validity, v.reason.clone())));
    }
    // V1-6: 복귀 직후 2초 이내엔 아직 not_worn
    assert!(all_not_worn(frame_at(&frames, base + 120.0 + 1.0)));
    // V1-7: 복귀 후 100초 뒤 값 재개, HR 은 착용 파형 75bpm ±3, not_worn 아님
    let g = frame_at(&frames, base + 210.0 - 1.0);
    let hr = g.metrics.bpm.value.expect("복귀 후 HR 없음");
    assert!((hr - 75.0).abs() <= 3.0, "복귀 HR {hr}");
    assert_ne!(g.metrics.bpm.reason.as_deref(), Some("not_worn"));
    assert!(g.metrics.sdnn.value.is_some(), "복귀 후 SDNN 재개 안 됨");
}

#[test]
fn buffers_cleared_on_entry_and_no_contamination() {
    // 미착용 중에는 분석 emission 이 없고, 복귀 후 RR 버퍼는 0 부터 다시 쌓인다.
    let ppg = gen(&[(Seg::Worn(75.0), 80.0), (Seg::Off(5_000.0), 20.0), (Seg::Worn(75.0), 12.0)]);
    let (_, rrlen) = run(&ppg, 50);
    let maxw = *rrlen.iter().take(60).max().unwrap();
    assert!(maxw > 20, "착용 중 RR 이 쌓여야 함: {maxw}");
    // 복귀 후 첫 분석들: 직전 착용 RR 이 남아있지 않다(버퍼 길이가 착용 정점보다 작고 0 부근에서 시작)
    let tail: Vec<usize> = rrlen.iter().rev().take(6).cloned().collect();
    assert!(*tail.iter().max().unwrap() < maxw / 2, "복귀 후 RR 버퍼 오염: {tail:?} vs {maxw}");
}

#[test]
fn mid_level_keeps_previous_state() {
    // V1-5: 착용 중 IR 300k(중간) 20초 → 계속 worn(값 유지, not_worn 아님)
    let mut ppg = gen(&[(Seg::Worn(75.0), 80.0)]);
    ppg.extend(gen(&[(Seg::Off(300_000.0), 20.0)]));
    let (frames, _) = run(&ppg, 25);
    for f in frames.iter().skip(frames.len().saturating_sub(15)) {
        assert!(!pm(f).iter().any(|v| v.reason.as_deref() == Some("not_worn")), "중간 구간에서 not_worn");
    }
    // 미착용 상태에서 중간 구간: 미착용 유지
    let mut ppg = gen(&[(Seg::Worn(75.0), 60.0), (Seg::Off(5_000.0), 10.0)]);
    ppg.extend(gen(&[(Seg::Off(300_000.0), 20.0)]));
    let (frames, _) = run(&ppg, 25);
    assert!(all_not_worn(frames.last().unwrap()), "중간 구간에서 복귀 오판");
}

#[test]
fn started_off_becomes_not_worn_after_hold() {
    let ppg = gen(&[(Seg::Off(5_000.0), 20.0)]);
    let (frames, _) = run(&ppg, 25);
    assert!(all_not_worn(frames.last().unwrap()));
}

#[test]
fn batch_size_invariant() {
    let ppg = gen(&[(Seg::Worn(75.0), 70.0), (Seg::Off(5_000.0), 20.0), (Seg::Worn(75.0), 70.0)]);
    let key = |fs: &[MetricFrame]| -> Vec<String> {
        fs.iter().map(|f| pm(f).iter().map(|v| format!("{:?}/{}/{:?}", v.value, v.validity, v.reason)).collect::<Vec<_>>().join("|")).collect()
    };
    let (a, _) = run(&ppg, 1);
    let (b, _) = run(&ppg, 25);
    let (c, _) = run(&ppg, 50);
    assert_eq!(key(&a), key(&b));
    assert_eq!(key(&b), key(&c));
}
