//! 표시값 정규화 포팅: eegScore.ts(코호트 B0) + eegSigmoidScore.ts(활성 모델) + eegPersonalScore.scoreIndices.
//! raw index 와 표시값은 별도 필드이며 이중 정규화를 하지 않는다. 종합점수는 만들지 않는다.
use super::math::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const TNA: (f64, f64) = (18.512342, 9298.234459);
const STRESS: (f64, f64) = (0.461857, 8.720813);
const FAA_ABS_P90: f64 = 0.799637;
const EMO: (f64, f64) = (0.235214, 7.241375);
const RELAX: (f64, f64, f64, f64) = (0.098243, 0.259726, 0.428846, 1.0);
const FOCUS: (f64, f64) = (0.381252, 5.608388);
const COG: (f64, f64) = (1.6066, 4.8083);
const LN_EPS: f64 = 1e-9;
const LN9: f64 = 2.1972245773362196; // Math.log(9)
const SIGMOID_C: f64 = LN9 / 1.2815515655446004;

fn clamp01(v: f64) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    v.max(0.0).min(1.0)
}
fn to_score(r: f64) -> f64 {
    js_round(clamp01(r) * 100.0)
}
fn ratio_scale(raw: f64) -> f64 {
    if !raw.is_finite() {
        return f64::NAN;
    }
    if raw > 10.0 {
        raw / 100.0
    } else {
        raw
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct RawInput {
    pub focus: f64,
    pub relaxation: f64,
    pub stress: f64,
    pub tna: f64,
    pub cognitive_load: f64,
    pub emotional_stability: f64,
    pub hemispheric_balance: f64,
    pub faa: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ScoreSet {
    pub focus: f64,
    pub relaxation: f64,
    pub stress: f64,
    pub total_power: f64,
    pub hemispheric_balance: f64,
    pub cognitive_load: f64,
    pub emotional_stability: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct SigmoidParam {
    pub m: f64,
    pub s: f64,
    pub direction: i8,
}

pub type ModelParams = BTreeMap<String, SigmoidParam>;

pub fn cohort(i: &RawInput) -> ScoreSet {
    let faa = match i.faa {
        Some(v) => Some(v),
        None => None, // 입력에 faa 키가 있고 null → 0점 (TS: idx.faa !== undefined → null 그대로)
    };
    let relax = {
        let (a, b, c, d) = RELAX;
        let v = ratio_scale(i.relaxation);
        if !v.is_finite() || v <= a {
            0.0
        } else if v < b {
            to_score((v - a) / (b - a))
        } else if v <= c {
            100.0
        } else {
            js_round((0.0f64).max(100.0 - 40.0 * ((v - c) / (d - c))))
        }
    };
    ScoreSet {
        focus: {
            let v = ratio_scale(i.focus);
            if !v.is_finite() { 0.0 } else { to_score((v - FOCUS.0) / (FOCUS.1 - FOCUS.0)) }
        },
        relaxation: relax,
        stress: {
            let v = ratio_scale(i.stress);
            if !v.is_finite() { 0.0 } else { to_score((STRESS.1 - v) / (STRESS.1 - STRESS.0)) }
        },
        total_power: if !i.tna.is_finite() { 0.0 } else { to_score((i.tna - TNA.0) / (TNA.1 - TNA.0)) },
        hemispheric_balance: match faa {
            Some(f) if f.is_finite() => to_score(1.0 - f.abs() / FAA_ABS_P90),
            _ => 0.0,
        },
        cognitive_load: if !i.cognitive_load.is_finite() { 0.0 } else { to_score((COG.1 - i.cognitive_load) / (COG.1 - COG.0)) },
        emotional_stability: if !i.emotional_stability.is_finite() { 0.0 } else { to_score((i.emotional_stability - EMO.0) / (EMO.1 - EMO.0)) },
    }
}

fn sigmoid(x: f64) -> f64 {
    if !x.is_finite() {
        return 0.5;
    }
    if x >= 20.0 {
        return 1.0;
    }
    if x <= -20.0 {
        return 0.0;
    }
    1.0 / (1.0 + exp(-x))
}

fn to_percent(r: f64) -> f64 {
    if !r.is_finite() {
        return 0.0;
    }
    js_round((99.5f64).min((0.5f64).max(r * 100.0)))
}

fn positive_only(key: &str) -> bool {
    matches!(key, "autonomicStability" | "sdnn" | "avgHeartRate")
}

fn transform(key: &str, raw: f64) -> Option<f64> {
    if !raw.is_finite() {
        return None;
    }
    if key == "faa" {
        return Some(raw.abs());
    }
    if key == "breathingStability" {
        return Some(raw);
    }
    if raw < 0.0 {
        return None;
    }
    if positive_only(key) && raw <= 0.0 {
        return None;
    }
    Some(log(raw + LN_EPS))
}

fn sigmoid_score(key: &str, raw: f64, p: &SigmoidParam) -> Option<f64> {
    if !(p.s > 0.0) || !p.m.is_finite() || !p.s.is_finite() {
        return None;
    }
    let z = transform(key, raw)?;
    if key == "faa" {
        let t = z / p.s;
        if !t.is_finite() {
            return None;
        }
        return Some(to_percent(exp(-std::f64::consts::LN_2 * t * t)));
    }
    let t = (z - p.m) / p.s;
    if !t.is_finite() {
        return None;
    }
    Some(to_percent(sigmoid(p.direction as f64 * SIGMOID_C * t)))
}

/// scoreIndices(idx, model): 활성 모델 > 코호트. params 없는 지표는 코호트 fallback.
pub fn score(i: &RawInput, model: Option<&ModelParams>) -> ScoreSet {
    let c = cohort(i);
    let Some(m) = model else { return c };
    let get = |key: &str, raw: f64| m.get(key).and_then(|p| if p.direction == 1 || p.direction == -1 { sigmoid_score(key, raw, p) } else { None });
    let faa_raw = match i.faa {
        Some(f) => f,
        None => i.hemispheric_balance,
    };
    ScoreSet {
        focus: get("focusIndex", i.focus).unwrap_or(c.focus),
        relaxation: get("relaxationIndex", i.relaxation).unwrap_or(c.relaxation),
        stress: get("stressIndex", i.stress).unwrap_or(c.stress),
        total_power: get("totalNeuralActivity", i.tna).unwrap_or(c.total_power),
        hemispheric_balance: get("faa", faa_raw).unwrap_or(c.hemispheric_balance),
        cognitive_load: get("cognitiveLoad", i.cognitive_load).unwrap_or(c.cognitive_load),
        emotional_stability: get("emotionalStability", i.emotional_stability).unwrap_or(c.emotional_stability),
    }
}
