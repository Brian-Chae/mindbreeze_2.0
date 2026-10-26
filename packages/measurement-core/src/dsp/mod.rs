//! DSP — 기존 승인 TS(frontend/src/lib/eeg/)의 v1 수치 계약을 그대로 포팅한다.
//! 모든 연산은 f64, TS 와 같은 연산 순서(좌→우 누적), fast-math/FMA/SIMD 재결합 없음.
pub mod acc;
pub mod biquad;
pub mod eeg;
pub mod hrv;
pub mod math;
pub mod ppg;
pub mod score;
