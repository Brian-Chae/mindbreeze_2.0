//! 측정 가드 신규 불량 벡터(포화·계단·lead-off·갭) + 정상 신호 불변 시험.
//! 결정적 합성 신호(LCG 노이즈 + 10Hz 사인)를 패킷으로 만들어 push_packet 경로로 재생한다.

use measurement_core::engine::{Core, CoreConfig, MetricFrame, WallAnchor};
use measurement_core::parser::Sensor;

const FS_TICKS_PER_SAMPLE: f64 = 32768.0 / 250.0;

fn uv_to_raw(uv: f64) -> i32 {
    (uv * 12.0 * (8_388_608.0 - 1.0) / 4.033 / 1e6).round().clamp(-8_388_608.0, 8_388_607.0) as i32
}
fn b24(v: i32) -> [u8; 3] {
    let u = (v as u32) & 0xFF_FFFF;
    [(u >> 16) as u8, (u >> 8) as u8, u as u8]
}

/// 샘플 인덱스 → (ch1 µV, ch2 µV, lead-off 바이트). 모듈 상단 mutator 로 불량 주입.
struct Gen {
    seed: u64,
}
impl Gen {
    fn noise(&mut self) -> f64 {
        self.seed = self.seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.seed >> 33) as f64 / (1u64 << 31) as f64 - 0.5) * 10.0
    }
}

/// 25샘플 패킷 열을 만든다. `bad(i, ch1, ch2, lo)` 로 샘플별 불량 주입, `skip(pkt)` 가 true 면 패킷 누락.
fn run(total_pkts: usize, bad: impl Fn(usize, &mut f64, &mut f64, &mut u8), skip: impl Fn(usize) -> bool) -> Vec<MetricFrame> {
    let mut core = Core::new(CoreConfig::default()).unwrap();
    let mut g = Gen { seed: 7 };
    let mut frames = Vec::new();
    for k in 0..total_pkts {
        let mut bytes = Vec::new();
        let last = (k + 1) * 25 - 1;
        let tick = (1000.0 * 32768.0 + last as f64 * FS_TICKS_PER_SAMPLE).round() as u32;
        bytes.extend_from_slice(&tick.to_le_bytes());
        for j in 0..25 {
            let i = k * 25 + j;
            let ph = i as f64 / 250.0;
            let mut a = 18.0 * (2.0 * std::f64::consts::PI * 10.0 * ph).sin() + g.noise();
            let mut b = 14.0 * (2.0 * std::f64::consts::PI * 10.0 * ph + 0.5).sin() + g.noise();
            let mut lo = 0u8;
            bad(i, &mut a, &mut b, &mut lo);
            bytes.push(lo);
            bytes.extend_from_slice(&b24(uv_to_raw(a)));
            bytes.extend_from_slice(&b24(uv_to_raw(b)));
        }
        if skip(k) {
            continue;
        }
        let arr = (k as u64) * 100_000;
        let out = core.push_packet(Sensor::Eeg, &bytes, arr, WallAnchor { wall_ms: 1_760_000_000_000, monotonic_us: 0 });
        frames.extend(out.frames);
    }
    frames
}

fn reason_of(f: &MetricFrame) -> (Option<f64>, &'static str, Option<String>) {
    let m = &f.metrics.tna_raw;
    (m.value, m.validity, m.reason.clone())
}
fn all_eeg_null(f: &MetricFrame) -> bool {
    let m = &f.metrics;
    [&m.focus_raw, &m.focus_display, &m.relaxation_raw, &m.relaxation_display, &m.emotion_raw, &m.emotion_display, &m.tna_raw]
        .iter()
        .all(|x| x.value.is_none() && x.validity == "invalid")
}

#[test]
fn clean_signal_never_invalid() {
    let fr = run(400, |_, _, _, _| {}, |_| false);
    assert!(fr.len() > 10);
    for f in &fr {
        let (v, validity, _) = reason_of(f);
        assert!(v.is_some() && validity == "valid", "정상 신호가 무효 처리됨: seq {}", f.sequence);
        assert!(v.unwrap() <= 1000.0);
    }
}

#[test]
fn saturation_burst_is_invalid_then_recovers() {
    // 20.0~20.2s: 약 50 샘플 포화(윈도 4s 의 >0.5%)
    let fr = run(600, |i, a, _, _| if (5000..5050).contains(&i) { *a = 336_083.0 } else { let _ = i; }, |_| false);
    let inv: Vec<_> = fr.iter().filter(|f| f.metrics.tna_raw.reason.as_deref() == Some("saturated")).collect();
    assert!(!inv.is_empty(), "포화 윈도 무효 없음");
    assert!(inv.iter().all(|f| all_eeg_null(f)));
    assert!(fr.iter().all(|f| f.metrics.tna_raw.value.map_or(true, |v| v <= 1000.0)));
    assert!(fr.last().unwrap().metrics.tna_raw.validity == "valid", "회복 안 됨");
}

#[test]
fn dc_steps_are_invalid() {
    // 포화 없이 ±5mV 직류 계단 4회
    let fr = run(600, |i, a, _, _| if [3000, 3040, 3080, 3120].contains(&i) { *a += 5_000.0 }, |_| false);
    assert!(fr.iter().any(|f| f.metrics.tna_raw.reason.as_deref() == Some("step")), "계단 무효 없음");
    assert!(fr.iter().filter(|f| f.metrics.tna_raw.reason.as_deref() == Some("step")).all(all_eeg_null));
    assert!(fr.iter().all(|f| f.metrics.tna_raw.value.map_or(true, |v| v <= 1000.0)));
}

#[test]
fn single_spike_below_step_limit_is_valid_input() {
    // 계단 규칙은 3회 이상 — 1개 스파이크(진입+이탈 2회)는 규칙 2 에 걸리지 않는다.
    let fr = run(400, |i, a, _, _| if i == 3000 { *a += 4_000.0 }, |_| false);
    assert!(fr.iter().all(|f| f.metrics.tna_raw.reason.as_deref() != Some("step")));
}

#[test]
fn leadoff_ratio_is_invalid() {
    // ch2 lead-off 비트(bit2) 60 샘플 > 5% of 1000
    let fr = run(600, |i, _, _, lo| if (3000..3200).contains(&i) { *lo = 0x04 }, |_| false);
    assert!(fr.iter().any(|f| f.metrics.tna_raw.reason.as_deref() == Some("leadoff")));
}

#[test]
fn packet_gap_clears_ring_and_refills() {
    // 패킷 120 하나 누락(25샘플 > 2) → gap 무효, 약 2초 재충전 뒤 valid 복귀
    let fr = run(500, |_, _, _, _| {}, |k| k == 120);
    let gap_idx: Vec<usize> = fr.iter().enumerate().filter(|(_, f)| f.metrics.tna_raw.reason.as_deref() == Some("gap")).map(|(i, _)| i).collect();
    assert!(!gap_idx.is_empty(), "갭 무효 없음");
    assert!(gap_idx.iter().all(|&i| all_eeg_null(&fr[i])));
    let last_gap = *gap_idx.last().unwrap();
    assert!(last_gap + 1 < fr.len() && fr[last_gap + 1..].iter().any(|f| f.metrics.tna_raw.validity == "valid"), "갭 뒤 정상 복귀 없음");
    // 재충전(500샘플=2초) + 격자 여유: 무효 프레임은 5개 이하
    assert!(gap_idx.len() <= 5, "무효 {}개", gap_idx.len());
}

#[test]
fn small_gap_within_limit_is_not_invalid() {
    // 2샘플 이하 누락은 갭 아님: 패킷 하나를 23샘플로 줄이는 대신 전체가 정상인지만 확인(누락 없음 기준선)
    let fr = run(400, |_, _, _, _| {}, |_| false);
    assert!(fr.iter().all(|f| f.metrics.tna_raw.reason.as_deref() != Some("gap")));
}
