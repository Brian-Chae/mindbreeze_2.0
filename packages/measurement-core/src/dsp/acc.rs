//! ACCSignalProcessor.ts(움직임 강도) + AnalysisMetricsService.processACCAnalysisMetrics(motion 0~1) 포팅.
use super::math::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct AccPoint {
    pub ts: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccResult {
    pub avg_movement: f64,
    pub std_movement: f64,
    pub max_movement: f64,
    pub intensity: f64,
    /// 0~1, 계산 불가 시 None
    pub motion: Option<f64>,
}

pub fn analyze(data: &[AccPoint]) -> Option<AccResult> {
    if data.is_empty() {
        return None;
    }
    let vals: Vec<f64> = data
        .iter()
        .map(|p| {
            let mag = sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
            (mag - 1.0).max(0.0) * 100.0
        })
        .collect();
    let avg = sum(&vals) / vals.len() as f64;
    let mut v = 0.0;
    for &x in &vals {
        let d = x - avg;
        v += d * d;
    }
    let std = sqrt(v / vals.len() as f64);
    let max = max_of(&vals);
    let intensity_f = if avg <= 5.0 {
        avg * 4.0
    } else if avg <= 15.0 {
        20.0 + (avg - 5.0) * 4.0
    } else {
        60.0 + (40.0f64).min((avg - 15.0) * 2.0)
    };
    let intensity = js_round(intensity_f);
    let motion = if intensity.is_finite() && intensity >= 0.0 { Some((intensity / 100.0).clamp(0.0, 1.0)) } else { None };
    Some(AccResult { avg_movement: avg, std_movement: std, max_movement: max, intensity, motion })
}
