//! EEG 분석 윈도 유효성 가드 (measure-guard).
//!
//! 포화·직류 계단·lead-off·불연속(갭) 윈도는 점수 산출 전에 걸러 EEG 지표를 명시적 null(invalid)로 낸다.
//! 정상 신호는 어떤 규칙에도 걸리지 않아 기존 출력과 비트 동일해야 한다.
//! 웹 TS 구현은 아래 상수·판정 순서를 동일하게 따른다 (정본 문서: guard-contract.md).

use crate::dsp::eeg::EegPoint;
use crate::parser::{eeg_uv, EEG_FULL_SCALE_RAW};
use serde::{Deserialize, Serialize};

/// 판정에 쓰는 최근 샘플 수 = 실제 분석에 들어가는 최대 샘플 수(eeg.rs MAX_ANALYSIS_SAMPLES 와 같음).
pub(crate) const GUARD_WINDOW: usize = 1000;
/// 규칙 1: 포화 임계 = 24비트 풀스케일 µV 의 98%.
pub(crate) const SATURATION_FRACTION: f64 = 0.98;
/// 규칙 1: 포화 샘플(어느 채널이든) 비율이 이 값을 초과하면 무효.
pub(crate) const SATURATION_RATIO_LIMIT: f64 = 0.005;
/// 규칙 2: 인접 샘플 차 |Δ| 가 이 값(µV) 이상이면 계단 1회.
pub(crate) const STEP_UV: f64 = 3_000.0;
/// 규칙 2: 채널별 계단 횟수가 이 값 이상이면 무효.
pub(crate) const STEP_COUNT_LIMIT: usize = 3;
/// 규칙 3: lead-off 비트가 켜진 샘플(어느 채널이든) 비율이 이 값을 초과하면 무효.
pub(crate) const LEADOFF_RATIO_LIMIT: f64 = 0.05;
/// 규칙 4: 장치 tick 기준 누락 샘플 수가 이 값을 초과하면 갭(링 비우고 재충전).
pub(crate) const GAP_SAMPLES_LIMIT: u32 = 2;
/// 규칙 5: 위 규칙을 통과했어도 TNA 가 이 값(2000, 1600대도 정상)을 넘으면 outlier 무효.
pub(crate) const OUTLIER_TNA_LIMIT: f64 = 2000.0;
/// 가드 강제 여부. false(기록만) = 판정 사유는 프레임 지표의 `reason` 과 GuardStats 에 남기되
/// 정상 산출한 지표값을 null 로 지우지 않는다(2026-10-28 대표 결정). true 로 되돌리면 무효 창 지표를 invalid(null)로 낸다.
/// 단 갭(Gap)은 분석 자체가 없어 값이 존재하지 않으므로 이 플래그와 무관하게 invalid 다.
/// 웹 TS 의 GUARD_ENFORCE(measureGuard.ts) 와 같은 값으로 유지한다.
pub const GUARD_ENFORCE: bool = false;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GuardReason {
    Saturated,
    Step,
    Leadoff,
    Gap,
    Outlier,
}

impl GuardReason {
    /// 계약 reason 문자열(소문자 snake, 서버 정규식 `^[a-z][a-z0-9_]{0,63}$`).
    pub fn code(self) -> &'static str {
        match self {
            GuardReason::Saturated => "saturated",
            GuardReason::Step => "step",
            GuardReason::Leadoff => "leadoff",
            GuardReason::Gap => "gap",
            GuardReason::Outlier => "outlier",
        }
    }
    pub fn index(self) -> usize {
        match self {
            GuardReason::Saturated => 0,
            GuardReason::Step => 1,
            GuardReason::Leadoff => 2,
            GuardReason::Gap => 3,
            GuardReason::Outlier => 4,
        }
    }
}

/// 포화 임계(µV): 파서 풀스케일(2^23-1)의 98%.
pub fn saturation_threshold_uv() -> f64 {
    eeg_uv(EEG_FULL_SCALE_RAW) * SATURATION_FRACTION
}

/// 규칙 1~3 판정. 우선순위: saturated > step > leadoff. 정상이면 None.
pub fn check_window(win: &[EegPoint]) -> Option<GuardReason> {
    let tail = if win.len() > GUARD_WINDOW { &win[win.len() - GUARD_WINDOW..] } else { win };
    let n = tail.len();
    if n == 0 {
        return None;
    }
    let thr = saturation_threshold_uv();
    let mut sat = 0usize;
    let mut lo = 0usize;
    let mut steps = [0usize; 2];
    for (i, p) in tail.iter().enumerate() {
        if p.fp1.abs() >= thr || p.fp2.abs() >= thr {
            sat += 1;
        }
        if p.lo1 || p.lo2 {
            lo += 1;
        }
        if i > 0 {
            let q = &tail[i - 1];
            if (p.fp1 - q.fp1).abs() >= STEP_UV {
                steps[0] += 1;
            }
            if (p.fp2 - q.fp2).abs() >= STEP_UV {
                steps[1] += 1;
            }
        }
    }
    if sat as f64 > SATURATION_RATIO_LIMIT * n as f64 {
        return Some(GuardReason::Saturated);
    }
    if steps[0].max(steps[1]) >= STEP_COUNT_LIMIT {
        return Some(GuardReason::Step);
    }
    if lo as f64 > LEADOFF_RATIO_LIMIT * n as f64 {
        return Some(GuardReason::Leadoff);
    }
    None
}

/// 가드 진단 카운터(윈도 단위). 인덱스는 `GuardReason::index`.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct GuardStats {
    pub windows_total: u64,
    pub invalid_by_reason: [u64; 5],
}

impl GuardStats {
    pub fn invalid_total(&self) -> u64 {
        self.invalid_by_reason.iter().sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(i: usize, a: f64, b: f64) -> EegPoint {
        EegPoint { ts: i as f64 * 4.0, fp1: a, fp2: b, lo1: false, lo2: false }
    }
    fn clean(n: usize) -> Vec<EegPoint> {
        (0..n).map(|i| pt(i, (i as f64 * 0.3).sin() * 50.0, (i as f64 * 0.2).cos() * 40.0)).collect()
    }

    #[test]
    fn outlier_tna_limit_is_2000() {
        assert_eq!(OUTLIER_TNA_LIMIT, 2000.0);
        for v in [1600.0, 1999.0, 2000.0] {
            assert!(v <= OUTLIER_TNA_LIMIT);
        }
        assert!(!(2000.1 <= OUTLIER_TNA_LIMIT));
    }

    #[test]
    fn threshold_is_98pct_fullscale() {
        let t = saturation_threshold_uv();
        assert!((t - 329_361.0).abs() < 100.0, "{t}");
    }
    #[test]
    fn clean_ok() {
        assert_eq!(check_window(&clean(1000)), None);
    }
    #[test]
    fn saturation_boundary() {
        let mut w = clean(1000);
        for k in 0..5 {
            w[100 + k * 10].fp1 = 336_083.0;
        }
        // 5/1000 = 0.5% — 초과가 아니므로 통과(단 계단 규칙은 따로)
        let mut w2 = w.clone();
        for p in w2.iter_mut() {
            if p.fp1 > 1e5 {
                p.fp1 = 0.0
            }
        }
        assert_eq!(check_window(&w2), None);
        w[300].fp2 = -336_083.0;
        // 6개 포화 → 무효(saturated 가 step 보다 우선)
        assert_eq!(check_window(&w), Some(GuardReason::Saturated));
    }
    #[test]
    fn step_count() {
        let mut w = clean(1000);
        w[200].fp1 = 5_000.0; // 진입+이탈 = 계단 2회
        assert_eq!(check_window(&w), None);
        w[500].fp1 = 5_000.0; // 4회
        assert_eq!(check_window(&w), Some(GuardReason::Step));
    }
    #[test]
    fn leadoff_ratio() {
        let mut w = clean(1000);
        for p in w.iter_mut().take(50) {
            p.lo1 = true;
        }
        assert_eq!(check_window(&w), None); // 정확히 5%
        w[60].lo2 = true;
        assert_eq!(check_window(&w), Some(GuardReason::Leadoff));
    }
}
