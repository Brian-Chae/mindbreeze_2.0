//! 골든 stream 을 네이티브로 재생해 CoreOutput 프레임/최종 manifest JSON 을 stdout 으로 낸다 (WASM 패리티 기준).
use measurement_core::engine::{Core, CoreConfig, WallAnchor};
use measurement_core::parser::Sensor;

fn main() {
    let dir = std::env::args().nth(1).expect("golden synth dir");
    let blob = std::fs::read(format!("{dir}/stream.bin")).unwrap();
    let sched: Vec<(u64, String, usize, usize)> = serde_json::from_slice(&std::fs::read(format!("{dir}/schedule.json")).unwrap()).unwrap();
    let mut core = Core::new(CoreConfig::default()).unwrap();
    let mut frames = Vec::new();
    let mut statuses = Vec::new();
    for (arr, s, off, len) in sched {
        let sensor = match s.as_str() { "eeg" => Sensor::Eeg, "ppg" => Sensor::Ppg, _ => Sensor::Acc };
        let out = core.push_packet(sensor, &blob[off..off + len], arr, WallAnchor { wall_ms: 1_760_000_000_000, monotonic_us: 0 });
        statuses.push(out.packet.status);
        frames.extend(out.frames);
    }
    let ck = core.checkpoint();
    let fin = core.close();
    // 구조체 직렬화 그대로(키 순서 포함) 출력 → WASM 과 바이트 단위 비교
    println!("{}", serde_json::to_string(&frames).unwrap());
    println!("{}", serde_json::to_string(&fin).unwrap());
    println!("{}", serde_json::to_string(&statuses).unwrap());
    println!("{}", ck.len());
}
