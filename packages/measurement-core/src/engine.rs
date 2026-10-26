//! 코어 엔진: 패킷 → 파서 → 센서 시계 → 웹 타임라인 → 링 버퍼 → DSP → MetricFrame.
//!
//! cadence 두 가지(같은 DSP):
//! - `SampleClock`(기본): 샘플 개수 기준(EEG 250, PPG 50, ACC 30 샘플마다). 패킷 batch 크기와 무관하게 출력 동일.
//! - `LegacyPacket`: 현 웹 StreamProcessor 의 패킷/도착시각 throttle 을 그대로 재현 — 계약 oracle 패리티 전용.

use crate::clock::{Admission, ClockConfig, SensorClock, Verdict};
use crate::dsp::biquad::FilterImpl;
use crate::dsp::acc::{self, AccPoint, AccResult};
use crate::dsp::eeg::{self, EegPoint, EegResult};
use crate::dsp::hrv::{HrvSnapshot, HrvState};
use crate::dsp::ppg::{self, PpgPoint, PpgResult};
use crate::dsp::score::{self, ModelParams, RawInput, ScoreSet};
use crate::parser::{fnv1a64, parse_packet, ParseError, Parsed, Sensor};
use crate::timeline::WebTimeline;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;

pub const ABI_VERSION: u32 = 1;
const EEG_RING: usize = 1250;
const PPG_RING: usize = 500;
const ACC_RING: usize = 150;
const FRAME_INTERVAL_US: u64 = 1_000_000;
const STALE_US: u64 = 3_000_000;
/// 헤더 tick(1/32768s) 양자화로 batch 마다 분석 종료 시각이 수십 µs 달라진다.
/// 프레임 격자 비교는 PPG 반 샘플(10ms)의 허용폭을 두어 경계 뒤집힘을 막는다.
const GRID_TOL_US: u64 = 10_000;

// ---------------------------------------------------------------- 설정

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelMode {
    LegacyCohort,
    ActiveSigmoid,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RatesHz {
    pub eeg: u32,
    pub ppg: u32,
    pub acc: u32,
}

/// 계약 `core-abi.schema.json#CoreConfig` 와 1:1 (unknown 필드 거절).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoreConfig {
    pub abi_version: u32,
    pub device_profile_version: String,
    pub algorithm_version: String,
    pub model_version: String,
    pub model_hash: String,
    pub model_mode: ModelMode,
    pub rates_hz: RatesHz,
    pub anchor: String,
    pub acc_interval_profile: String,
}

impl Default for CoreConfig {
    fn default() -> Self {
        CoreConfig {
            abi_version: ABI_VERSION,
            device_profile_version: "linkband2-v1".into(),
            algorithm_version: "web-ts-1".into(),
            model_version: "b0-cohort-2".into(),
            model_hash: "a".repeat(64),
            model_mode: ModelMode::LegacyCohort,
            rates_hz: RatesHz { eeg: 250, ppg: 50, acc: 30 },
            anchor: "last_sample_web_v1".into(),
            acc_interval_profile: "rounded_33333us_v1".into(),
        }
    }
}

impl CoreConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.abi_version != ABI_VERSION {
            return Err(format!("abi_version {} 미지원", self.abi_version));
        }
        if self.rates_hz != (RatesHz { eeg: 250, ppg: 50, acc: 30 }) {
            return Err("v1 코어는 rates 250/50/30 만 지원(ACC 25Hz profile 은 별도 version)".into());
        }
        if self.anchor != "last_sample_web_v1" {
            return Err("anchor 는 last_sample_web_v1 만 지원(first_sample_sdk 는 profile 변경 후)".into());
        }
        if self.acc_interval_profile != "rounded_33333us_v1" {
            return Err("acc_interval_profile 은 rounded_33333us_v1 만 지원".into());
        }
        if self.model_hash.len() != 64 || !self.model_hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err("model_hash 는 소문자 sha256 hex 64자".into());
        }
        for v in [&self.device_profile_version, &self.algorithm_version, &self.model_version] {
            if v.is_empty() || v.len() > 64 {
                return Err("version label 길이 1..64".into());
            }
        }
        Ok(())
    }
    fn fingerprint(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(serde_json::to_vec(self).unwrap());
        h.finalize().into()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cadence {
    SampleClock,
    LegacyPacket,
}

/// 계약 밖 Rust 튜닝(ABI JSON 으로는 노출하지 않음).
#[derive(Clone, Copy, Debug)]
pub struct Tuning {
    pub cadence: Cadence,
    pub emit_spectrum: bool,
    pub filter: FilterImpl,
}
impl Default for Tuning {
    fn default() -> Self {
        Tuning { cadence: Cadence::SampleClock, emit_spectrum: false, filter: FilterImpl::Biquad }
    }
}

// ---------------------------------------------------------------- 오류·출력

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum ErrorCode {
    Ok = 0,
    InvalidHandle = 1,
    BufferTooSmall = 2,
    InvalidConfig = 3,
    CheckpointCorrupt = 4,
    PanicContained = 5,
    Oom = 6,
    InvalidArgument = 7,
}

impl ErrorCode {
    pub fn name(self) -> &'static str {
        match self {
            ErrorCode::Ok => "ok",
            ErrorCode::InvalidHandle => "invalid_handle",
            ErrorCode::BufferTooSmall => "buffer_too_small",
            ErrorCode::InvalidConfig => "invalid_config",
            ErrorCode::CheckpointCorrupt => "checkpoint_corrupt",
            ErrorCode::PanicContained => "panic_contained",
            ErrorCode::Oom => "oom",
            // 계약 CoreError.code enum 에 없는 값은 invalid_config 로 투영(메시지에 상세)
            ErrorCode::InvalidArgument => "invalid_config",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct CoreError {
    pub code: String,
    pub message: String,
}
impl CoreError {
    pub fn ok() -> Self {
        CoreError { code: "ok".into(), message: String::new() }
    }
    pub fn new(code: ErrorCode, msg: &str) -> Self {
        CoreError { code: code.name().into(), message: msg.chars().take(200).collect() }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct PacketResult {
    pub sensor: Sensor,
    pub status: &'static str,
    pub segment: u32,
    pub extended_ticks: Option<String>,
    pub samples: u32,
    pub raw_preserved: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct MetricValue {
    pub value: Option<f64>,
    pub unit: &'static str,
    pub validity: &'static str,
    pub reason: Option<String>,
    pub last_valid_sequence: Option<String>,
    pub last_valid_observed_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MetricSet {
    pub focus_raw: MetricValue,
    pub focus_display: MetricValue,
    pub relaxation_raw: MetricValue,
    pub relaxation_display: MetricValue,
    pub emotion_raw: MetricValue,
    pub emotion_display: MetricValue,
    pub bpm: MetricValue,
    pub respiration: MetricValue,
    pub sdnn: MetricValue,
}

#[derive(Clone, Debug, Serialize)]
pub struct Contact {
    pub fp1: &'static str,
    pub fp2: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct MetricFrame {
    pub sequence: String,
    pub window_start_us: String,
    pub window_end_us: String,
    pub observed_at_ms: u64,
    pub sqi: Option<f64>,
    pub contact: Contact,
    pub metrics: MetricSet,
    pub feature_hash: String,
}

#[derive(Clone, Debug)]
pub struct EegEmission {
    pub now_ms: f64,
    pub end_sample_index: u64,
    pub window_end_ts: f64,
    pub result: EegResult,
    pub scores_cohort: ScoreSet,
    pub scores_model: Option<ScoreSet>,
}
#[derive(Clone, Debug)]
pub struct PpgEmission {
    pub now_ms: f64,
    pub end_sample_index: u64,
    pub window_end_ts: f64,
    pub result: PpgResult,
    pub hrv: HrvSnapshot,
    pub resp_null_reason: Option<String>,
    pub rr_buffer_len: usize,
}
#[derive(Clone, Debug)]
pub struct AccEmission {
    pub now_ms: f64,
    pub end_sample_index: u64,
    pub result: AccResult,
}
#[derive(Clone, Debug)]
pub enum Emission {
    Eeg(EegEmission),
    Ppg(PpgEmission),
    Acc(AccEmission),
}

/// 계약 CoreOutput = {packet, frames, error}. `emissions`/`clock` 는 진단·패리티용(직렬화 제외).
#[derive(Debug, Serialize)]
pub struct PushOutput {
    pub packet: PacketResult,
    pub frames: Vec<MetricFrame>,
    pub error: CoreError,
    #[serde(skip)]
    pub emissions: Vec<Emission>,
    #[serde(skip)]
    pub admission: Option<Admission>,
    #[serde(skip)]
    pub sample_times: Vec<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FinalManifest {
    pub final_sequences: FinalSeq,
    pub segments: u32,
    pub raw_sha256: String,
    pub feature_sha256: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct FinalSeq {
    pub eeg: String,
    pub ppg: String,
    pub acc: String,
    pub metric: String,
}

#[derive(Clone, Copy, Debug)]
pub struct WallAnchor {
    pub wall_ms: u64,
    pub monotonic_us: u64,
}

// ---------------------------------------------------------------- 상태

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum ContactState {
    Contact,
    Leadoff,
    Unknown,
}
impl ContactState {
    fn name(self) -> &'static str {
        match self {
            ContactState::Contact => "contact",
            ContactState::Leadoff => "leadoff",
            ContactState::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LatestEeg {
    end_us: u64,
    contact: [ContactState; 2],
    observed_ms: u64,
    sqi01: f64,
    focus: f64,
    relaxation: f64,
    emotion: f64,
    cohort: ScoreSet,
    model: Option<ScoreSet>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct LatestPpg {
    end_us: u64,
    observed_ms: u64,
    hrv: HrvSnapshot,
    resp_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CoreState {
    clocks: [SensorClock; 3],
    timelines: [WebTimeline; 3],
    eeg: VecDeque<EegPoint>,
    ppg: VecDeque<PpgPoint>,
    acc: VecDeque<AccPoint>,
    totals: [u64; 3],
    last_eeg_analysis_ms: Option<i64>,
    hrv: HrvState,
    contact: [ContactState; 2],
    /// 분석 이력(최근 8개). 프레임은 격자 시각 T 이하의 최신 분석값으로 만든다 → batch 크기와 무관.
    eeg_hist: VecDeque<LatestEeg>,
    ppg_hist: VecDeque<LatestPpg>,
    /// 센서별 처리된 마지막 샘플 시각(µs). 프레임 격자 진행의 워터마크.
    wm_us: [Option<u64>; 2],
    next_frame_us: Option<u64>,
    seq: u64,
    last_valid: [Option<(u64, u64)>; 9],
    last_push_mono_us: Option<u64>,
    last_data_end_us: u64,
    gap_open: bool,
    model: Option<ModelParams>,
    raw_chain: [u8; 32],
    feature_chain: [u8; 32],
    segments_seen: u32,
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    fingerprint: [u8; 32],
    state: CoreState,
}

pub struct Core {
    cfg: CoreConfig,
    tuning: Tuning,
    s: CoreState,
}

fn chain(prev: &[u8; 32], parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(prev);
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

pub fn hex(b: &[u8]) -> String {
    const D: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for &x in b {
        s.push(D[(x >> 4) as usize] as char);
        s.push(D[(x & 15) as usize] as char);
    }
    s
}

fn idx(s: Sensor) -> usize {
    s.index()
}

impl Core {
    pub fn new(cfg: CoreConfig) -> Result<Core, String> {
        Core::with_tuning(cfg, Tuning::default())
    }

    pub fn with_tuning(cfg: CoreConfig, tuning: Tuning) -> Result<Core, String> {
        cfg.validate()?;
        let cc = ClockConfig::default();
        let quant = tuning.cadence == Cadence::SampleClock;
        let s = CoreState {
            clocks: [SensorClock::new(Sensor::Eeg, cc), SensorClock::new(Sensor::Ppg, cc), SensorClock::new(Sensor::Acc, cc)],
            timelines: [WebTimeline::new(Sensor::Eeg, quant), WebTimeline::new(Sensor::Ppg, quant), WebTimeline::new(Sensor::Acc, quant)],
            eeg: VecDeque::new(),
            ppg: VecDeque::new(),
            acc: VecDeque::new(),
            totals: [0; 3],
            last_eeg_analysis_ms: None,
            hrv: HrvState::default(),
            contact: [ContactState::Unknown; 2],
            eeg_hist: VecDeque::new(),
            ppg_hist: VecDeque::new(),
            wm_us: [None, None],
            next_frame_us: None,
            seq: 0,
            last_valid: [None; 9],
            last_push_mono_us: None,
            last_data_end_us: 0,
            gap_open: false,
            model: None,
            raw_chain: [0; 32],
            feature_chain: [0; 32],
            segments_seen: 1,
        };
        Ok(Core { cfg, tuning, s })
    }

    pub fn config(&self) -> &CoreConfig {
        &self.cfg
    }

    /// 활성 sigmoid 모델 파라미터 주입(수업 시작에 pin, 도중 교체 금지는 호출자 책임).
    pub fn set_model(&mut self, params: ModelParams) {
        self.s.model = Some(params);
    }

    // ---- checkpoint / restore ----

    pub fn checkpoint(&self) -> Vec<u8> {
        let snap = Snapshot { fingerprint: self.cfg.fingerprint(), state: self.s.clone() };
        let body = postcard::to_allocvec(&snap).expect("checkpoint 직렬화");
        let mut out = Vec::with_capacity(body.len() + 40);
        out.extend_from_slice(b"MBC1");
        out.extend_from_slice(&body);
        let d: [u8; 32] = Sha256::digest(&out).into();
        out.extend_from_slice(&d);
        out
    }

    pub fn restore(cfg: CoreConfig, bytes: &[u8]) -> Result<Core, String> {
        Core::restore_with_tuning(cfg, Tuning::default(), bytes)
    }

    pub fn restore_with_tuning(cfg: CoreConfig, tuning: Tuning, bytes: &[u8]) -> Result<Core, String> {
        cfg.validate()?;
        if bytes.len() < 4 + 32 || &bytes[..4] != b"MBC1" {
            return Err("checkpoint 형식 오류".into());
        }
        let (body, tail) = bytes.split_at(bytes.len() - 32);
        let d: [u8; 32] = Sha256::digest(body).into();
        if d[..] != tail[..] {
            return Err("checkpoint 무결성 해시 불일치".into());
        }
        let snap: Snapshot = postcard::from_bytes(&body[4..]).map_err(|e| format!("checkpoint 역직렬화 실패: {e}"))?;
        if snap.fingerprint != cfg.fingerprint() {
            return Err("checkpoint 가 다른 config(알고리즘/모델/profile 버전)로 만들어짐".into());
        }
        Ok(Core { cfg, tuning, s: snap.state })
    }

    // ---- 패킷 투입 ----

    pub fn push_packet(&mut self, sensor: Sensor, bytes: &[u8], arrival_monotonic_us: u64, anchor: WallAnchor) -> PushOutput {
        self.s.raw_chain = chain(&self.s.raw_chain, &[&[sensor.code()], &(bytes.len() as u32).to_le_bytes(), bytes]);
        self.s.gap_open = false;
        self.s.last_push_mono_us = Some(arrival_monotonic_us);

        let wall_us: i128 = anchor.wall_ms as i128 * 1000 + (arrival_monotonic_us as i128 - anchor.monotonic_us as i128);
        let now_ms = wall_us.div_euclid(1000) as f64; // Date.now()
        let i = idx(sensor);

        let invalid = |this: &Core, status: &'static str| PushOutput {
            packet: PacketResult { sensor, status, segment: this.s.clocks[i].segment(), extended_ticks: None, samples: 0, raw_preserved: true },
            frames: vec![],
            error: CoreError::ok(),
            emissions: vec![],
            admission: None,
            sample_times: vec![],
        };

        let parsed = match parse_packet(sensor, bytes) {
            Ok(p) => p,
            Err(ParseError::HeaderShort { .. }) => return invalid(self, "invalid_header_short"),
            Err(ParseError::TooShort { .. }) => return invalid(self, "invalid_too_short"),
            Err(ParseError::TrailingBytes { .. }) => return invalid(self, "invalid_remainder"),
        };
        let n = parsed.n_samples();
        let adm = self.s.clocks[i].admit(parsed.header_raw(), fnv1a64(bytes), n, wall_us.clamp(i64::MIN as i128, i64::MAX as i128) as i64);
        let status = match adm.verdict {
            Verdict::Accept => "accepted",
            Verdict::Duplicate => "duplicate",
            Verdict::Conflict => "conflict",
            Verdict::OutOfOrder => "out_of_order",
        };
        let mut out = PushOutput {
            packet: PacketResult {
                sensor,
                status,
                segment: adm.segment,
                extended_ticks: Some(adm.ext_tick.max(0).to_string()),
                samples: if adm.verdict == Verdict::Accept { n as u32 } else { 0 },
                raw_preserved: true,
            },
            frames: vec![],
            error: CoreError::ok(),
            emissions: vec![],
            admission: Some(adm),
            sample_times: vec![],
        };
        if adm.verdict != Verdict::Accept {
            return out;
        }

        if adm.flags.segment_reset {
            // 새 segment: 불연속 구간이므로 이 센서의 링과 타임라인을 새로 시작한다.
            self.s.timelines[i] = WebTimeline::new(sensor, self.tuning.cadence == Cadence::SampleClock);
            match sensor {
                Sensor::Eeg => self.s.eeg.clear(),
                Sensor::Ppg => self.s.ppg.clear(),
                Sensor::Acc => self.s.acc.clear(),
            }
            self.s.segments_seen = self.s.segments_seen.max(adm.segment + 1);
        }
        let times = self.s.timelines[i].sample_times(adm.ext_tick, n, now_ms);
        out.sample_times = times.clone();
        let arrival_ms = (arrival_monotonic_us / 1000) as i64;
        let legacy = self.tuning.cadence == Cadence::LegacyPacket;

        match parsed {
            Parsed::Eeg(p) => {
                for (k, s) in p.samples.iter().enumerate() {
                    self.s.eeg.push_back(EegPoint { ts: times[k], fp1: s.ch1_uv, fp2: s.ch2_uv, lo1: s.leadoff_ch1, lo2: s.leadoff_ch2 });
                    if self.s.eeg.len() > EEG_RING {
                        self.s.eeg.pop_front();
                    }
                    self.s.totals[0] += 1;
                    self.s.wm_us[0] = Some(ts_us(times[k]));
                    self.s.contact = [if s.leadoff_ch1 { ContactState::Leadoff } else { ContactState::Contact }, if s.leadoff_ch2 { ContactState::Leadoff } else { ContactState::Contact }];
                    if !legacy && self.s.totals[0] % 250 == 0 && self.s.eeg.len() >= 500 {
                        let t = times[k];
                        self.run_eeg(t, t.floor(), &mut out);
                    }
                }
                if legacy && self.s.eeg.len() >= 500 && self.s.last_eeg_analysis_ms.map_or(true, |l| arrival_ms - l >= 1000) {
                    self.s.last_eeg_analysis_ms = Some(arrival_ms);
                    self.run_eeg(*times.last().unwrap(), now_ms, &mut out);
                }
            }
            Parsed::Ppg(p) => {
                for (k, s) in p.samples.iter().enumerate() {
                    self.s.ppg.push_back(PpgPoint { ts: times[k], red: s.red as f64, ir: s.ir as f64 });
                    if self.s.ppg.len() > PPG_RING {
                        self.s.ppg.pop_front();
                    }
                    self.s.totals[1] += 1;
                    self.s.wm_us[1] = Some(ts_us(times[k]));
                    if !legacy && self.s.totals[1] % 50 == 0 {
                        let t = times[k];
                        self.run_ppg(t, t.floor(), &mut out);
                    }
                }
                if legacy && self.s.ppg.len() >= 50 {
                    self.run_ppg(*times.last().unwrap(), now_ms, &mut out);
                }
            }
            Parsed::Acc(p) => {
                for (k, s) in p.samples.iter().enumerate() {
                    self.s.acc.push_back(AccPoint { ts: times[k], x: s.x, y: s.y, z: s.z });
                    if self.s.acc.len() > ACC_RING {
                        self.s.acc.pop_front();
                    }
                    self.s.totals[2] += 1;
                    if !legacy && self.s.totals[2] % 30 == 0 {
                        self.run_acc(times[k].floor(), &mut out);
                    }
                }
                if legacy && self.s.acc.len() >= 30 {
                    self.run_acc(now_ms, &mut out);
                }
            }
        }
        self.drain_frames(&mut out);
        out
    }

    fn run_eeg(&mut self, last_ts: f64, now_ms: f64, out: &mut PushOutput) {
        let win: Vec<EegPoint> = self.s.eeg.iter().copied().collect();
        let Some(res) = eeg::analyze(&win, self.tuning.emit_spectrum, self.tuning.filter) else { return };
        let ix = res.indices;
        let input = RawInput {
            focus: ix.focus_index,
            relaxation: ix.relaxation_index,
            stress: ix.stress_index,
            tna: ix.total_neural_activity,
            cognitive_load: ix.cognitive_load,
            emotional_stability: ix.emotional_stability,
            hemispheric_balance: ix.hemispheric_balance,
            faa: ix.faa,
        };
        let cohort = score::score(&input, None);
        let model = self.s.model.as_ref().map(|m| score::score(&input, Some(m)));
        let end_us = ts_us(last_ts);
        self.s.eeg_hist.push_back(LatestEeg {
            end_us,
            contact: self.s.contact,
            observed_ms: last_ts.max(0.0).floor() as u64,
            sqi01: (res.sqi_overall_pct / 100.0).clamp(0.0, 1.0),
            focus: ix.focus_index,
            relaxation: ix.relaxation_index,
            emotion: ix.emotional_stability,
            cohort,
            model,
        });
        if self.s.eeg_hist.len() > 8 {
            self.s.eeg_hist.pop_front();
        }
        self.anchor_grid(end_us);
        out.emissions.push(Emission::Eeg(EegEmission { now_ms, end_sample_index: self.s.totals[0], window_end_ts: last_ts, result: res, scores_cohort: cohort, scores_model: model }));
    }

    fn run_ppg(&mut self, last_ts: f64, now_ms: f64, out: &mut PushOutput) {
        let win: Vec<PpgPoint> = self.s.ppg.iter().copied().collect();
        let res = ppg::analyze(&win, self.tuning.filter);
        self.s.hrv.process_ppg(res.heart_rate_raw, &res.rr, &res.rr_end_ts, now_ms);
        let hrv = self.s.hrv.snapshot();
        let reason = self.s.hrv.resp_null_reason().map(|s| s.to_string());
        let end_us = ts_us(last_ts);
        self.s.ppg_hist.push_back(LatestPpg { end_us, observed_ms: last_ts.max(0.0).floor() as u64, hrv: hrv.clone(), resp_reason: reason.clone() });
        if self.s.ppg_hist.len() > 8 {
            self.s.ppg_hist.pop_front();
        }
        self.anchor_grid(end_us);
        out.emissions.push(Emission::Ppg(PpgEmission {
            now_ms,
            end_sample_index: self.s.totals[1],
            window_end_ts: last_ts,
            result: res,
            hrv,
            resp_null_reason: reason,
            rr_buffer_len: self.s.hrv.rr_buffer_len(),
        }));
    }

    fn run_acc(&mut self, now_ms: f64, out: &mut PushOutput) {
        let win: Vec<AccPoint> = self.s.acc.iter().copied().collect();
        let Some(res) = acc::analyze(&win) else { return };
        if let Some(m) = res.motion {
            self.s.hrv.set_motion(Some(m));
        }
        out.emissions.push(Emission::Acc(AccEmission { now_ms, end_sample_index: self.s.totals[2], result: res }));
    }

    /// 시간 경과만으로 만드는 프레임: 3초 이상 새 패킷이 없으면 gap 프레임 1회.
    pub fn advance(&mut self, monotonic_us: u64) -> Vec<MetricFrame> {
        let Some(last) = self.s.last_push_mono_us else { return vec![] };
        if self.s.gap_open || monotonic_us < last || monotonic_us - last < STALE_US {
            return vec![];
        }
        self.s.gap_open = true;
        let end_us = self.s.last_data_end_us + (monotonic_us - last);
        let mut out = PushOutput {
            packet: PacketResult { sensor: Sensor::Eeg, status: "accepted", segment: 0, extended_ticks: None, samples: 0, raw_preserved: true },
            frames: vec![],
            error: CoreError::ok(),
            emissions: vec![],
            admission: None,
            sample_times: vec![],
        };
        self.emit_frame(end_us, &mut out);
        // 공백 뒤 첫 분석에서 격자를 다시 잡는다(시간 역행 방지).
        self.s.next_frame_us = None;
        out.frames
    }

    /// 첫 분석 시각을 1초 격자의 원점으로 삼는다.
    fn anchor_grid(&mut self, end_us: u64) {
        if end_us > self.s.last_data_end_us {
            self.s.last_data_end_us = end_us;
        }
        if self.s.next_frame_us.is_none() {
            self.s.next_frame_us = Some(end_us);
        }
    }

    /// 격자 시각 T 의 프레임은 (처리된 센서 전부가 T 이상 진행)했을 때 만든다.
    /// 내용은 T 이하의 최신 분석값만 사용하므로 패킷 크기·도착 순서와 무관하다.
    fn drain_frames(&mut self, out: &mut PushOutput) {
        let Some(mut t) = self.s.next_frame_us else { return };
        let wm = self.s.wm_us.iter().flatten().copied().min();
        let Some(wm) = wm else { return };
        let mut n = 0;
        while t + GRID_TOL_US <= wm && n < 60 {
            self.emit_frame(t, out);
            t += FRAME_INTERVAL_US;
            n += 1;
        }
        self.s.next_frame_us = Some(t);
    }

    fn emit_frame(&mut self, end_us: u64, out: &mut PushOutput) {
        self.s.seq += 1;
        let seq = self.s.seq;
        let observed_ms = end_us / 1000;
        let eeg_at = self.s.eeg_hist.iter().rev().find(|e| e.end_us <= end_us + GRID_TOL_US).cloned();
        let ppg_at = self.s.ppg_hist.iter().rev().find(|p| p.end_us <= end_us + GRID_TOL_US).cloned();
        let contact_now = eeg_at.as_ref().map(|e| e.contact).unwrap_or([ContactState::Unknown; 2]);
        let mode = self.cfg.model_mode;
        let both_off = contact_now[0] == ContactState::Leadoff && contact_now[1] == ContactState::Leadoff;

        let eeg_state: Result<&LatestEeg, (&'static str, &'static str)> = match &eeg_at {
            None => Err(("warming_up", "insufficient_window")),
            Some(e) if end_us.saturating_sub(e.end_us) > STALE_US => Err(("gap", "no_recent_eeg")),
            Some(_) if both_off => Err(("invalid", "leadoff")),
            Some(e) => Ok(e),
        };
        let ppg_fresh = ppg_at.as_ref().filter(|p| end_us.saturating_sub(p.end_us) <= STALE_US);

        let mut lv = self.s.last_valid;
        let mut mk = |slot: usize, unit: &'static str, v: Result<f64, (&'static str, &'static str)>| -> MetricValue {
            match v {
                Ok(x) if x.is_finite() => {
                    lv[slot] = Some((seq, observed_ms));
                    MetricValue { value: Some(x), unit, validity: "valid", reason: None, last_valid_sequence: Some(seq.to_string()), last_valid_observed_at_ms: Some(observed_ms) }
                }
                Ok(_) => MetricValue {
                    value: None,
                    unit,
                    validity: "invalid",
                    reason: Some("non_finite".into()),
                    last_valid_sequence: lv[slot].map(|l| l.0.to_string()),
                    last_valid_observed_at_ms: lv[slot].map(|l| l.1),
                },
                Err((validity, reason)) => MetricValue {
                    value: None,
                    unit,
                    validity,
                    reason: Some(reason.into()),
                    last_valid_sequence: lv[slot].map(|l| l.0.to_string()),
                    last_valid_observed_at_ms: lv[slot].map(|l| l.1),
                },
            }
        };

        let disp = |e: &LatestEeg, pick: fn(&ScoreSet) -> f64| -> Result<f64, (&'static str, &'static str)> {
            match mode {
                ModelMode::LegacyCohort => Ok(pick(&e.cohort)),
                ModelMode::ActiveSigmoid => match &e.model {
                    Some(m) => Ok(pick(m)),
                    None => Err(("invalid", "model_unavailable")),
                },
            }
        };
        let raw = |f: fn(&LatestEeg) -> f64| eeg_state.map(f);
        let displ = |pick: fn(&ScoreSet) -> f64| eeg_state.and_then(|e| disp(e, pick));

        let focus_raw = mk(0, "index_raw", raw(|e| e.focus));
        let focus_display = mk(1, "score_0_100", displ(|s| s.focus));
        let relaxation_raw = mk(2, "index_raw", raw(|e| e.relaxation));
        // 이완도 표시 = 하루명상 '두뇌 휴식'(TNA 반전). 모델 없으면 코호트 폴백 없이 pending.
        let relaxation_display = mk(
            3,
            "score_0_100",
            eeg_state.and_then(|e| match (mode, &e.model) {
                (ModelMode::ActiveSigmoid, Some(m)) => m.brain_rest.ok_or(("invalid", "model_unavailable")),
                _ => Err(("invalid", "model_unavailable")),
            }),
        );
        let emotion_raw = mk(4, "index_raw", raw(|e| e.emotion));
        let emotion_display = mk(5, "score_0_100", displ(|s| s.emotional_stability));

        let ppg_gate = |p: Option<&LatestPpg>, have_any: bool| -> Result<(), (&'static str, &'static str)> {
            match p {
                Some(_) => Ok(()),
                None if have_any => Err(("gap", "no_recent_ppg")),
                None => Err(("warming_up", "no_ppg_data")),
            }
        };
        let have_ppg = ppg_at.is_some();
        let gate = ppg_gate(ppg_fresh, have_ppg);
        let bpm = mk(6, "beats_per_min", gate.and_then(|_| ppg_fresh.unwrap().hrv.heart_rate.ok_or(("warming_up", "no_heartbeat_yet"))));
        let sdnn = mk(8, "ms", gate.and_then(|_| ppg_fresh.unwrap().hrv.sdnn.ok_or(("warming_up", "insufficient_rr_window"))));
        let resp = mk(
            7,
            "breaths_per_min",
            gate.and_then(|_| {
                let p = ppg_fresh.unwrap();
                match p.hrv.respiratory_rate {
                    Some(v) => Ok(v),
                    None => Err(match p.resp_reason.as_deref() {
                        Some("out_of_physiological_range") => ("invalid", "out_of_physiological_range"),
                        Some("no_dominant_frequency") => ("invalid", "no_dominant_frequency"),
                        Some("calculation_failed") => ("invalid", "calculation_failed"),
                        Some("insufficient_resampled_points") => ("warming_up", "insufficient_resampled_points"),
                        Some("insufficient_rr_buffer") => ("warming_up", "insufficient_rr_buffer"),
                        Some("no_ppg_data") | None => ("warming_up", "no_ppg_data"),
                        Some(_) => ("warming_up", "insufficient_window"),
                    }),
                }
            }),
        );
        self.s.last_valid = lv;

        let metrics = MetricSet { focus_raw, focus_display, relaxation_raw, relaxation_display, emotion_raw, emotion_display, bpm, respiration: resp, sdnn };
        let contact = Contact { fp1: contact_now[0].name(), fp2: contact_now[1].name() };
        let sqi = match &eeg_at {
            Some(e) if end_us.saturating_sub(e.end_us) <= STALE_US => Some(e.sqi01),
            _ => None,
        };
        let start_us = end_us.saturating_sub(FRAME_INTERVAL_US);
        let fh = {
            let body = serde_json::to_vec(&(seq, start_us, end_us, sqi, &contact, &metrics)).expect("frame 직렬화");
            let d: [u8; 32] = Sha256::digest(&body).into();
            d
        };
        self.s.feature_chain = chain(&self.s.feature_chain, &[&fh]);
        out.frames.push(MetricFrame {
            sequence: seq.to_string(),
            window_start_us: start_us.to_string(),
            window_end_us: end_us.to_string(),
            observed_at_ms: observed_ms,
            sqi,
            contact,
            metrics,
            feature_hash: hex(&fh),
        });
    }

    pub fn close(&mut self) -> FinalManifest {
        FinalManifest {
            final_sequences: FinalSeq {
                eeg: self.s.totals[0].to_string(),
                ppg: self.s.totals[1].to_string(),
                acc: self.s.totals[2].to_string(),
                metric: self.s.seq.to_string(),
            },
            segments: self.s.segments_seen.max(1),
            raw_sha256: hex(&self.s.raw_chain),
            feature_sha256: hex(&self.s.feature_chain),
        }
    }
}

fn ts_us(ts_ms: f64) -> u64 {
    if ts_ms.is_finite() && ts_ms > 0.0 {
        (ts_ms * 1000.0).floor() as u64
    } else {
        0
    }
}
