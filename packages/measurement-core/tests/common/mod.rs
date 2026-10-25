//! 계약(contracts/biosignal-golden/v1, 읽기 전용) fixture 로더 + 비교 도구.
//! expected 는 T01 oracle(기존 TS 수정 없이 실행)이 만든 것이며 Rust 로 생성하지 않는다.
#![allow(dead_code)]

use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn golden_dir() -> PathBuf {
    if let Ok(p) = std::env::var("MC_GOLDEN_DIR") {
        return PathBuf::from(p);
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contracts/biosignal-golden/v1")
}

pub fn read_json(rel: &str) -> Value {
    let p = golden_dir().join(rel);
    serde_json::from_slice(&std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))).unwrap()
}

pub fn read_bin(rel: &str) -> Vec<u8> {
    let p = golden_dir().join(rel);
    std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

pub const BASE_MS: u64 = 1_760_000_000_000;

#[derive(Default, Debug)]
pub struct Cmp {
    pub max_abs: f64,
    pub max_rel: f64,
    pub n: usize,
    pub fails: Vec<String>,
}

impl Cmp {
    /// 실수: abs≤abs_tol 또는 rel≤rel_tol (N07)
    pub fn num(&mut self, what: &str, expect: &Value, got: Option<f64>, abs_tol: f64, rel_tol: f64) {
        self.n += 1;
        match (expect, got) {
            (Value::Null, None) => {}
            (Value::Null, Some(g)) => self.fails.push(format!("{what}: expected null, got {g}")),
            (e, None) => self.fails.push(format!("{what}: expected {e}, got null")),
            (e, Some(g)) => {
                let e = e.as_f64().unwrap_or_else(|| panic!("{what}: expected 가 숫자 아님 {e}"));
                let abs = (e - g).abs();
                let rel = if e.abs() > 0.0 { abs / e.abs() } else { abs };
                if abs > self.max_abs {
                    self.max_abs = abs;
                }
                if abs > abs_tol && rel > self.max_rel {
                    self.max_rel = rel;
                }
                if !(abs <= abs_tol || rel <= rel_tol) {
                    self.fails.push(format!("{what}: expected {e}, got {g} (abs {abs:e}, rel {rel:e})"));
                }
            }
        }
    }
    /// 정수·분기: 정확 일치
    pub fn exact(&mut self, what: &str, expect: &Value, got: Option<f64>) {
        self.num(what, expect, got, 0.0, 0.0)
    }
    pub fn eq<T: PartialEq + std::fmt::Debug>(&mut self, what: &str, a: T, b: T) {
        self.n += 1;
        if a != b {
            self.fails.push(format!("{what}: expected {a:?}, got {b:?}"));
        }
    }
    pub fn assert_ok(&self, name: &str) {
        println!("[{name}] compared={} max_abs={:e} max_rel(>abs_tol)={:e} fails={}", self.n, self.max_abs, self.max_rel, self.fails.len());
        assert!(
            self.fails.is_empty(),
            "{name}: {} 불일치 / {} 비교:\n{}",
            self.fails.len(),
            self.n,
            self.fails.iter().take(30).cloned().collect::<Vec<_>>().join("\n")
        );
    }
}
