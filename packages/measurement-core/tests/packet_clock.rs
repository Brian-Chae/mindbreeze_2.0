//! T02-1: 패킷 파서 + 센서별 시계 (plan §5.2, §9.2 T02).
//! 바이트 정본: 공식 SDK `python_core/app/core/device.py`.

use measurement_core::clock::{ClockConfig, SensorClock, Verdict};
use measurement_core::parser::{fnv1a64, parse_packet, ParseError, Parsed, Sensor};

fn eeg_packet(header: u32, samples: &[(u8, i32, i32)]) -> Vec<u8> {
    let mut v = header.to_le_bytes().to_vec();
    for &(lo, a, b) in samples {
        v.push(lo);
        v.extend_from_slice(&(a as u32).to_be_bytes()[1..4]);
        v.extend_from_slice(&(b as u32).to_be_bytes()[1..4]);
    }
    v
}

#[allow(dead_code)]
fn ppg_packet(header: u32, samples: &[(u32, u32)]) -> Vec<u8> {
    let mut v = header.to_le_bytes().to_vec();
    for &(r, i) in samples {
        v.extend_from_slice(&r.to_be_bytes()[1..4]);
        v.extend_from_slice(&i.to_be_bytes()[1..4]);
    }
    v
}

fn clock(sensor: Sensor) -> SensorClock {
    SensorClock::new(sensor, ClockConfig::default())
}

// ---------- 파서 ----------

#[test]
fn ppg_header_is_little_endian() {
    // SDK _handle_ppg: data[3]<<24|data[2]<<16|data[1]<<8|data[0]
    let bytes = [0x00, 0x80, 0x00, 0x00, 0, 0, 1, 0, 0, 2];
    match parse_packet(Sensor::Ppg, &bytes).unwrap() {
        Parsed::Ppg(p) => {
            assert_eq!(p.header_raw, 0x8000); // BE 로 읽으면 0x0080_0000
            assert_eq!(p.samples.len(), 1);
            assert_eq!((p.samples[0].red, p.samples[0].ir), (1, 2));
        }
        _ => panic!("PPG 가 아님"),
    }
}

#[test]
fn eeg_signed24_leadoff_and_microvolt_scale() {
    let bytes = eeg_packet(100, &[(0x05, -1, -8_388_608), (0x00, 8_388_607, 0)]);
    let Parsed::Eeg(p) = parse_packet(Sensor::Eeg, &bytes).unwrap() else { panic!() };
    assert_eq!(p.header_raw, 100);
    assert_eq!(p.samples.len(), 2);
    assert!(p.samples[0].leadoff_ch1 && p.samples[0].leadoff_ch2); // bit0, bit2
    assert!(!p.samples[1].leadoff_ch1 && !p.samples[1].leadoff_ch2);
    assert_eq!(p.samples[0].raw_ch1, -1);
    assert_eq!(p.samples[0].raw_ch2, -8_388_608);
    let expect = -1.0f64 * 4.033 / 12.0 / (8_388_608.0 - 1.0) * 1e6;
    assert_eq!(p.samples[0].ch1_uv.to_bits(), expect.to_bits());
}

#[test]
fn acc_little_endian_signed16() {
    let mut b = 7u32.to_le_bytes().to_vec();
    for v in [-8192i16, 8192, 1] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    let Parsed::Acc(p) = parse_packet(Sensor::Acc, &b).unwrap() else { panic!() };
    assert_eq!(p.samples[0].x, -0.5);
    assert_eq!(p.samples[0].y, 0.5);
    assert_eq!(p.samples[0].z, 1.0 * (2.0 / 32768.0));
}

#[test]
fn truncated_and_trailing_bytes_are_invalid_not_silently_cut() {
    assert!(matches!(parse_packet(Sensor::Eeg, &[1, 2, 3]), Err(ParseError::HeaderShort { got: 3 })));
    assert!(matches!(parse_packet(Sensor::Eeg, &[0; 7]), Err(ParseError::TooShort { .. })));
    assert!(matches!(
        parse_packet(Sensor::Ppg, &[0, 0, 0, 0, 1, 2, 3]),
        Err(ParseError::TooShort { .. })
    ));
    let mut b = eeg_packet(5, &[(0, 1, 2)]);
    b.extend_from_slice(&[9, 9, 9]); // 7바이트 샘플이 안 되는 꼬리
    assert!(matches!(parse_packet(Sensor::Eeg, &b), Err(ParseError::TrailingBytes { extra: 3 })));
}

// ---------- 시계 ----------

fn adm(c: &mut SensorClock, raw: u32, payload: &[u8], n: usize, wall_us: i64) -> measurement_core::clock::Admission {
    c.admit(raw, fnv1a64(payload), n, wall_us)
}

#[test]
fn wrap_extends_to_64bit_without_new_segment() {
    let mut c = clock(Sensor::Eeg);
    let w = 1_700_000_000_000_000i64;
    let a = adm(&mut c, u32::MAX - 100, b"a", 25, w);
    assert_eq!(a.verdict, Verdict::Accept);
    let b = adm(&mut c, 3276u32.wrapping_sub(101), b"b", 25, w + 100_000); // 100ms 뒤: 32bit 경계 넘김
    assert_eq!(b.verdict, Verdict::Accept);
    assert_eq!(a.segment, b.segment);
    assert!(b.ext_tick > a.ext_tick);
    assert_eq!(b.ext_tick - a.ext_tick, 3276);
    // 두 패킷 시각 차 = 3276틱 ≒ 99.976ms
    assert_eq!(b.last_sample_wall_us - a.last_sample_wall_us, 99_976);
}

#[test]
fn large_backward_jump_is_tick_reset_new_segment() {
    let mut c = clock(Sensor::Eeg);
    let w = 1_700_000_000_000_000i64;
    let a = adm(&mut c, 1_000_000, b"a", 25, w);
    let b = adm(&mut c, 500, b"b", 25, w + 5_000_000);
    assert_eq!(b.verdict, Verdict::Accept);
    assert_eq!(b.segment, a.segment + 1);
    assert!(b.flags.segment_reset);
    // 새 구간은 도착 벽시계에 재앵커
    assert_eq!(b.last_sample_wall_us, w + 5_000_000);
}

#[test]
fn sensors_have_independent_origins() {
    let mut eeg = clock(Sensor::Eeg);
    let mut ppg = clock(Sensor::Ppg);
    let w = 1_700_000_000_000_000i64;
    // 같은 순간 도착, 장치 카운터는 서로 수십 시간 다름
    let e = adm(&mut eeg, 5_000, b"e", 25, w);
    let p = adm(&mut ppg, 900_000_000, b"p", 25, w);
    assert_eq!(e.last_sample_wall_us, w);
    assert_eq!(p.last_sample_wall_us, w);
    let e2 = adm(&mut eeg, 5_000 + 32768, b"e2", 25, w + 1_000_000);
    let p2 = adm(&mut ppg, 900_000_000 + 32768, b"p2", 25, w + 1_000_000);
    assert_eq!(e2.last_sample_wall_us - e.last_sample_wall_us, 1_000_000);
    assert_eq!(p2.last_sample_wall_us - p.last_sample_wall_us, 1_000_000);
}

#[test]
fn duplicate_notification_and_same_tick_conflict() {
    // 계약 clock_rules: 직전과 같은 tick → duplicate/conflict, 2초 이내 과거 tick → out_of_order
    let mut c = clock(Sensor::Ppg);
    let w = 1_700_000_000_000_000i64;
    assert_eq!(adm(&mut c, 10_000, b"x", 25, w).verdict, Verdict::Accept);
    assert_eq!(adm(&mut c, 20_000, b"y", 25, w + 300_000).verdict, Verdict::Accept);
    assert_eq!(adm(&mut c, 20_000, b"y", 25, w + 310_000).verdict, Verdict::Duplicate);
    assert_eq!(adm(&mut c, 20_000, b"y-other", 25, w + 320_000).verdict, Verdict::Conflict);
    assert_eq!(adm(&mut c, 15_000, b"z", 25, w + 330_000).verdict, Verdict::OutOfOrder);
    assert_eq!(adm(&mut c, 10_000, b"x", 25, w + 340_000).verdict, Verdict::OutOfOrder);
}

#[test]
fn gap_samples_counted_from_header_jump() {
    let mut c = clock(Sensor::Ppg); // 50Hz
    let w = 1_700_000_000_000_000i64;
    let a = adm(&mut c, 0, b"a", 25, w);
    assert_eq!(a.gap_samples, 0);
    // 정상 간격: 25샘플 = 0.5s = 16384틱
    let b = adm(&mut c, 16_384, b"b", 25, w + 500_000);
    assert_eq!(b.gap_samples, 0);
    // 0.5초 + 2초 공백 = 100샘플 유실
    let d = adm(&mut c, 16_384 + 16_384 + 65_536, b"c", 25, w + 3_000_000);
    assert_eq!(d.gap_samples, 100);
}

#[test]
fn future_header_reanchors_and_flags() {
    let mut c = clock(Sensor::Ppg);
    let w = 1_700_000_000_000_000i64;
    let a = adm(&mut c, 0, b"a", 25, w);
    // 도착은 1초 뒤인데 장치 시각은 60초 뒤 → 미래 시각
    let b = adm(&mut c, 60 * 32768, b"b", 25, w + 1_000_000);
    assert!(b.flags.future);
    assert!(b.flags.reanchored);
    assert!(b.anchor_id > a.anchor_id);
    // 재앵커 뒤에는 미래가 아님
    assert!(b.last_sample_wall_us <= w + 1_000_000 + 5_000_000);
}

#[test]
fn wall_clock_regression_beyond_five_minutes_marks_uncertain() {
    let mut c = clock(Sensor::Eeg);
    let w = 1_700_000_000_000_000i64;
    adm(&mut c, 0, b"a", 25, w);
    // 벽시계가 10분 뒤로 점프, 장치는 1초만 진행
    let b = adm(&mut c, 32_768, b"b", 25, w + 600_000_000);
    assert!(b.flags.clock_uncertain);
    assert!(b.flags.reanchored);
}
