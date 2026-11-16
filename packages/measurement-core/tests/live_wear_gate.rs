//! 라이브 맥박 게이트(no_pulse) + 불변식: 착용·미착용·책상 잡음과 무관하게 프레임/emission/원시 체인이 계속 나간다.
use measurement_core::dsp::ppg::{pulse_gate_pass, valid_rr_ratio, PULSE_AC_MIN_SD};
use measurement_core::engine::{Core, CoreConfig, Emission, MetricFrame, WallAnchor};
use measurement_core::parser::Sensor;

const ANCHOR: WallAnchor = WallAnchor { wall_ms: 1_760_000_000_000, monotonic_us: 0 };

#[derive(Clone, Copy)]
enum Seg {
    /// 착용+맥박: IR 직류 1.42M + 맥파
    Pulse(f64),
    /// 책상 잡음: DC 가 착용 구간(≥50만)인데 교류 SD 만 작다(잡음 진폭 amp)
    Desk(f64, f64),
    /// 미착용 공기값
    Off(f64),
}

fn gen(segs: &[(Seg, f64)]) -> Vec<(u32, u32)> {
    let tau = std::f64::consts::TAU;
    let (mut out, mut phi, mut seed, mut k) = (Vec::new(), 0.0, 9u64, 0usize);
    let mut noise = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((seed >> 32) as f64 / 2147483648.0) - 1.0
    };
    for &(seg, secs) in segs {
        for _ in 0..(secs * 50.0) as usize {
            let t = k as f64 / 50.0;
            let (red, ir) = match seg {
                Seg::Pulse(bpm) => {
                    phi += (bpm + 4.0 * (tau * 0.25 * t).sin()) / 60.0 / 50.0;
                    let p = (tau * phi).sin() + 0.3 * (2.0 * tau * phi).sin();
                    (1_300_000.0 + 3000.0 * p + 40.0 * noise(), 1_420_000.0 + 4000.0 * p + 40.0 * noise())
                }
                Seg::Desk(dc, amp) => (dc * 0.7 + amp * noise(), dc + amp * noise()),
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

struct Run {
    frames: Vec<MetricFrame>,
    emissions: usize,
    accepted_packets: usize,
}

fn run(ppg: &[(u32, u32)]) -> Run {
    let mut core = Core::new(CoreConfig::default()).unwrap();
    let (mut frames, mut emissions, mut accepted, mut p) = (Vec::new(), 0, 0, 0);
    while p < ppg.len() {
        let end = (p + 25).min(ppg.len());
        let out = core.push_packet(Sensor::Ppg, &pkt(&ppg[p..end], end), (end as u64) * 20_000, ANCHOR);
        if out.packet.samples == 25 || out.packet.samples > 0 {
            accepted += 1;
        }
        emissions += out.emissions.iter().filter(|e| matches!(e, Emission::Ppg(_))).count();
        frames.extend(out.frames);
        p = end;
    }
    Run { frames, emissions, accepted_packets: accepted }
}

fn ppg_reasons(f: &MetricFrame) -> Vec<Option<String>> {
    let m = &f.metrics;
    [&m.bpm, &m.sdnn, &m.rmssd, &m.lf_power, &m.hf_power, &m.lf_hf_ratio, &m.respiration].iter().map(|v| v.reason.clone()).collect()
}
fn all_no_pulse(f: &MetricFrame) -> bool {
    let m = &f.metrics;
    [&m.bpm, &m.sdnn, &m.rmssd, &m.lf_power, &m.hf_power, &m.lf_hf_ratio, &m.respiration]
        .iter()
        .all(|v| v.value.is_none() && v.validity == "invalid" && v.reason.as_deref() == Some("no_pulse"))
}

#[test]
fn gate_thresholds_shared_with_recompute() {
    let good = vec![830.0; 10];
    assert_eq!(PULSE_AC_MIN_SD, 6.0);
    assert!(!pulse_gate_pass(5.9, &good));
    assert!(pulse_gate_pass(6.0, &good));
    let spread: Vec<f64> = (0..100).map(|i| 300.0 + i as f64 * 15.0).collect();
    assert!(valid_rr_ratio(&spread) < 0.5);
    assert!(!pulse_gate_pass(10.0, &[800.0, 810.0]));
}

#[test]
fn desk_noise_in_worn_range_gives_no_pulse() {
    // 책상 위 DC 88만(착용 구간)·교류 SD≈1~2 잡음 60초 → 링이 찬 뒤 PPG 지표 전부 null+no_pulse
    let r = run(&gen(&[(Seg::Desk(880_000.0, 3.0), 60.0)]));
    let last = r.frames.last().unwrap();
    assert!(all_no_pulse(last), "{:?}", ppg_reasons(last));
}

#[test]
fn real_pulse_passes_gate() {
    let r = run(&gen(&[(Seg::Pulse(75.0), 90.0)]));
    let f = r.frames.last().unwrap();
    assert!(f.metrics.bpm.value.is_some() && f.metrics.sdnn.value.is_some(), "{:?}", ppg_reasons(f));
    assert!(!ppg_reasons(f).iter().any(|x| x.as_deref() == Some("no_pulse")));
}

#[test]
fn invariants_hold_regardless_of_wear_state() {
    // 같은 길이(90초)의 세 입력: 맥박 / 책상 잡음 / 미착용 → 패킷 수용·프레임 수·emission 수·EEG 외 motion 프레임 동일
    let a = run(&gen(&[(Seg::Pulse(75.0), 90.0)]));
    let b = run(&gen(&[(Seg::Desk(880_000.0, 3.0), 90.0)]));
    let c = run(&gen(&[(Seg::Off(5_000.0), 90.0)]));
    assert_eq!(a.accepted_packets, b.accepted_packets);
    assert_eq!(a.accepted_packets, c.accepted_packets);
    assert_eq!(a.frames.len(), b.frames.len(), "프레임(live metric 창) 수가 착용 판정으로 달라짐");
    assert_eq!(a.frames.len(), c.frames.len());
    assert!(!a.frames.is_empty());
    // 분석 emission 은 착용 분기에서만 — 책상 잡음(no_pulse)은 착용 취급이라 pulse 와 같은 수 유지
    assert_eq!(a.emissions, b.emissions);
}

#[test]
fn desk_to_pulse_recovers() {
    // 책상 잡음 → 착용 맥박 전환: 링이 새 맥박으로 차면 값 회복
    let r = run(&gen(&[(Seg::Desk(880_000.0, 3.0), 40.0), (Seg::Pulse(75.0), 100.0)]));
    let f = r.frames.last().unwrap();
    assert!(f.metrics.bpm.value.is_some(), "회복 안 됨: {:?}", ppg_reasons(f));
}
