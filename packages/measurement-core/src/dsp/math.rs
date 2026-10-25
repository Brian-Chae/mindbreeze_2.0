//! 플랫폼 std 수학 차이를 피하기 위해 초월함수는 libm(순수 Rust) 으로 고정한다.
pub use libm::{cos, exp, log, log10, pow, sin};

pub fn sqrt(x: f64) -> f64 {
    x.sqrt() // IEEE-754 정확 반올림
}

/// JS `Math.round`: .5 는 +∞ 방향(음수 -2.5 → -2).
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `arr.reduce((a,b)=>a+b, 0)` — 순차 누적.
pub fn sum(v: &[f64]) -> f64 {
    let mut s = 0.0;
    for &x in v {
        s += x;
    }
    s
}

/// 모분산 (분모 N). TS: reduce(Math.pow(v-mean,2))/N, pow(x,2)==x*x (fdlibm).
pub fn variance(v: &[f64]) -> f64 {
    let mean = sum(v) / v.len() as f64;
    let mut s = 0.0;
    for &x in v {
        let d = x - mean;
        s += d * d;
    }
    s / v.len() as f64
}

pub fn max_of(v: &[f64]) -> f64 {
    let mut m = f64::NEG_INFINITY;
    for &x in v {
        if x > m {
            m = x;
        }
    }
    m
}

pub fn min_of(v: &[f64]) -> f64 {
    let mut m = f64::INFINITY;
    for &x in v {
        if x < m {
            m = x;
        }
    }
    m
}
