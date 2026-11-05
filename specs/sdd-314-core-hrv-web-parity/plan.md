# SDD-314 — Plan
1. 웹 TS(link-band-sdk-web, MB2.0 lib/eeg)와 Rust(dsp/ppg.rs, hrv.rs) 항목별 대조.
2. dev 회차 83a39b18 PPG 원문 패킷을 Rust example(`examples/replay_ppg_raw.rs`)과 node 하니스로 동일 재생.
3. 원인: hrv.rs 의 개수 상한(RR 120 / SDNN 60)과 시간조건(60s / 30s)의 충돌 → 시간 기반 확장(상한 400).
4. 합성 시험 `tests/sdd314_hrv_gates.rs`, 기존 cargo 전체 회귀.
