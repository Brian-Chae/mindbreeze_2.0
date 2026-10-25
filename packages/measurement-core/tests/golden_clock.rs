//! T01 gf01/gf02 packets → 파서·시계가 계약 expected 와 일치하는지 (정수·분기 exact).

mod common;
use common::*;
use measurement_core::engine::{Core, CoreConfig, WallAnchor};
use measurement_core::parser::{parse_packet, Parsed, Sensor};

fn sensor_of(s: &str) -> Sensor {
    match s {
        "eeg" => Sensor::Eeg,
        "ppg" => Sensor::Ppg,
        _ => Sensor::Acc,
    }
}

#[test]
fn gf02_streams_match_expected_status_segment_ticks() {
    for name in ["gf02_wrap32", "gf02_reset_segment", "gf02_duplicate_conflict_order", "gf02_multisensor_origin", "gf02_truncated"] {
        let exp = read_json(&format!("expected/{name}.json"));
        let mut core = Core::new(CoreConfig::default()).unwrap();
        let mut c = Cmp::default();
        for (i, p) in exp["packets"].as_array().unwrap().iter().enumerate() {
            let bytes = read_bin(p["file"].as_str().unwrap());
            let sensor = sensor_of(p["sensor"].as_str().unwrap());
            let arrival = p["arrival_us"].as_u64().unwrap();
            let out = core.push_packet(sensor, &bytes, arrival, WallAnchor { wall_ms: BASE_MS, monotonic_us: 0 });
            let want_status = match p["status"].as_str().unwrap() {
                "invalid" => p["strict_status"].as_str().unwrap(),
                s => s,
            };
            c.eq(&format!("{name}[{i}] status"), want_status, out.packet.status);
            if matches!(want_status, "accepted" | "duplicate" | "conflict" | "out_of_order") {
                c.eq(&format!("{name}[{i}] segment"), p["segment"].as_u64().unwrap() as u32, out.packet.segment);
                // 확장 tick 은 segment 내 u64. 계약은 wrap 뒤 값을 그대로 둔다.
                c.eq(&format!("{name}[{i}] ext"), p["extended_ticks"].as_i64().unwrap().to_string(), out.packet.extended_ticks.clone().unwrap());
            }
            assert!(out.packet.raw_preserved);
        }
        c.assert_ok(name);
    }
}

#[test]
fn gf01_decode_matches_independent_arithmetic() {
    // PPG LE 헤더, ACC signed16, EEG signed24/leadoff — 손계산 expected
    let ppg = read_bin("packets/gf01_ppg_header_le_1s.bin");
    let Parsed::Ppg(p) = parse_packet(Sensor::Ppg, &ppg).unwrap() else { panic!() };
    let e = read_json("expected/gf01_ppg_header_le_1s.json");
    assert_eq!(p.header_raw as u64, e["header_ticks"].as_u64().unwrap());
    for (s, w) in p.samples.iter().zip(e["samples"].as_array().unwrap()) {
        assert_eq!((s.red as u64, s.ir as u64), (w["red"].as_u64().unwrap(), w["ir"].as_u64().unwrap()));
    }
    let probe = read_bin("packets/gf01_ppg_header_endian_probe.bin");
    let Parsed::Ppg(q) = parse_packet(Sensor::Ppg, &probe).unwrap() else { panic!() };
    assert_eq!(q.header_raw, 67305985); // 0x04030201 — BE 로 읽으면 16909060

    let acc = read_bin("packets/gf01_acc_signed16.bin");
    let Parsed::Acc(a) = parse_packet(Sensor::Acc, &acc).unwrap() else { panic!() };
    let e = read_json("expected/gf01_acc_signed16.json");
    for (s, w) in a.samples.iter().zip(e["samples"].as_array().unwrap()) {
        assert_eq!(s.x, w["x_g"].as_f64().unwrap());
        assert_eq!(s.y, w["y_g"].as_f64().unwrap());
        assert_eq!(s.z, w["z_g"].as_f64().unwrap());
    }

    let eeg = read_bin("packets/gf01_eeg_signed24_leadoff.bin");
    let Parsed::Eeg(g) = parse_packet(Sensor::Eeg, &eeg).unwrap() else { panic!() };
    let e = read_json("expected/gf01_eeg_signed24_leadoff.json");
    for (s, w) in g.samples.iter().zip(e["samples"].as_array().unwrap()) {
        assert_eq!(s.raw_ch1 as i64, w["ch1_signed"].as_i64().unwrap());
        let want: f64 = w["ch1_uv_exact"].as_str().unwrap().parse().unwrap();
        assert!((s.ch1_uv - want).abs() <= 1e-9 * want.abs().max(1.0), "{} vs {}", s.ch1_uv, want);
    }
}
