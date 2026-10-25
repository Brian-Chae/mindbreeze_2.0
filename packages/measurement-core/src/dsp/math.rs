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

/// JS `arr.sort((a, b) => a - b)` 재현: 비교 결과가 NaN 이면 0(같음)으로 취급하는 안정 병합 정렬.
/// Rust `sort_by` 는 전순서가 아니면 panic 할 수 있어 NaN 입력(퇴화 PPG)에서 쓰지 않는다.
/// NaN 이 섞이면 결과 순서가 V8 TimSort 와 비트 단위로 같다고 보증하지 않는다(정상 입력은 동일).
pub fn js_sort_numeric(v: &mut Vec<f64>) {
    let cmp = |a: f64, b: f64| -> i8 {
        let d = a - b;
        if d > 0.0 {
            1
        } else if d < 0.0 {
            -1
        } else {
            0
        }
    };
    if v.len() < 2 {
        return;
    }
    let mut src = v.clone();
    let mut dst = vec![0.0; v.len()];
    let n = v.len();
    let mut width = 1;
    while width < n {
        let mut i = 0;
        while i < n {
            let mid = (i + width).min(n);
            let hi = (i + 2 * width).min(n);
            let (mut l, mut r, mut k) = (i, mid, i);
            while l < mid && r < hi {
                if cmp(src[l], src[r]) <= 0 {
                    dst[k] = src[l];
                    l += 1;
                } else {
                    dst[k] = src[r];
                    r += 1;
                }
                k += 1;
            }
            while l < mid {
                dst[k] = src[l];
                l += 1;
                k += 1;
            }
            while r < hi {
                dst[k] = src[r];
                r += 1;
                k += 1;
            }
            i += 2 * width;
        }
        std::mem::swap(&mut src, &mut dst);
        width *= 2;
    }
    *v = src;
}

/// JS `Math.min(a, b)`: 어느 한쪽이 NaN 이면 NaN (Rust `f64::min` 은 NaN 을 무시한다).
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) }
}
/// JS `Math.max(a, b)`: 어느 한쪽이 NaN 이면 NaN.
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) }
}
