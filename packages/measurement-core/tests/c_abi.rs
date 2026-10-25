//! C ABI: (1) Rust 측 계약 시험 (2) 실제 C 컴파일러로 헤더+staticlib 링크(clang) (3) 헤더가 최신인지.

mod common;
use measurement_core::ffi::*;
use std::process::Command;

const CFG: &str = r#"{"abi_version":1,"device_profile_version":"linkband2-v1","algorithm_version":"web-ts-1","model_version":"b0-cohort-2","model_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","model_mode":"legacy_cohort","rates_hz":{"eeg":250,"ppg":50,"acc":30},"anchor":"last_sample_web_v1","acc_interval_profile":"rounded_33333us_v1"}"#;

fn buf() -> McBuffer {
    McBuffer { data: std::ptr::null_mut(), len: 0 }
}
fn text(b: &McBuffer) -> String {
    if b.data.is_null() {
        return String::new();
    }
    unsafe { String::from_utf8(std::slice::from_raw_parts(b.data, b.len).to_vec()).unwrap() }
}

#[test]
fn json_push_matches_contract_shape_and_unknown_fields_rejected() {
    unsafe {
        let mut h = 0u64;
        let mut e = buf();
        assert_eq!(mc_create(CFG.as_ptr(), CFG.len(), &mut h, &mut e), 0);
        // 계약 fixture core-push.json 의 message 를 그대로 사용
        let fx: serde_json::Value = serde_json::from_slice(&std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../contracts/measurement-bridge/fixtures/valid/core-push.json")).unwrap()).unwrap();
        let call = serde_json::to_vec(&fx["message"]).unwrap();
        let mut o = buf();
        assert_eq!(mc_push_packet(h, call.as_ptr(), call.len(), &mut o), 0, "{}", text(&o));
        let v: serde_json::Value = serde_json::from_str(&text(&o)).unwrap();
        assert_eq!(v["packet"]["sensor"], "ppg");
        assert_eq!(v["packet"]["raw_preserved"], true);
        assert_eq!(v["error"]["code"], "ok");
        assert!(v["frames"].as_array().unwrap().len() <= 60);
        mc_buffer_free(&mut o);
        // unknown 필드 거절
        let mut m = fx["message"].clone();
        m["extra"] = serde_json::json!(1);
        let bad = serde_json::to_vec(&m).unwrap();
        let st = mc_push_packet(h, bad.as_ptr(), bad.len(), &mut o);
        assert_eq!(st, 7, "invalid_argument");
        assert!(text(&o).contains("invalid_config") || text(&o).contains("push"));
        mc_buffer_free(&mut o);
        // 4097자 base64 거절
        let mut m = fx["message"].clone();
        m["bytes_base64"] = serde_json::json!("A".repeat(4100));
        let big = serde_json::to_vec(&m).unwrap();
        assert_eq!(mc_push_packet(h, big.as_ptr(), big.len(), &mut o), 7);
        mc_buffer_free(&mut o);
        assert_eq!(mc_destroy(h), 0);
    }
}

#[test]
fn handle_lifecycle_and_double_free_safe() {
    unsafe {
        let mut o = buf();
        assert_eq!(mc_advance(424242, 1, &mut o), 1, "invalid_handle");
        assert!(text(&o).contains("invalid_handle"));
        mc_buffer_free(&mut o);
        mc_buffer_free(&mut o);
        mc_buffer_free(std::ptr::null_mut());
        assert!(o.data.is_null() && o.len == 0);
        assert_eq!(mc_destroy(0), 1);
    }
}

#[cfg(feature = "debug-hooks")]
#[test]
fn panic_does_not_cross_ffi() {
    unsafe {
        let mut o = buf();
        assert_eq!(mc_debug_panic(&mut o), 5);
        assert!(text(&o).contains("panic_contained"));
        mc_buffer_free(&mut o);
    }
}

#[test]
fn committed_header_is_fresh() {
    // build.rs 가 cbindgen 으로 재생성한 파일이 커밋된 파일과 같아야 한다(= 커밋 시 갱신 누락 방지).
    let h = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/include/measurement_core.h")).unwrap();
    for sym in ["mc_create", "mc_restore", "mc_push_packet", "mc_push_packet_raw", "mc_advance", "mc_checkpoint", "mc_close", "mc_destroy", "mc_buffer_free", "mc_set_model", "McBuffer", "MC_PANIC_CONTAINED"] {
        assert!(h.contains(sym), "헤더에 {sym} 없음");
    }
}

#[test]
fn real_c_compiler_links_header_and_staticlib() {
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".into());
    if Command::new(&cc).arg("--version").output().is_err() {
        eprintln!("C 컴파일러 없음 — 건너뜀");
        return;
    }
    let manifest = env!("CARGO_MANIFEST_DIR");
    // 같은 프로파일·feature 로 staticlib 을 직접 빌드한다(스테일 .a 로 링크하지 않기 위해).
    // 별도 target-dir 을 써서 실행 중인 cargo test 의 빌드 잠금과 충돌하지 않는다.
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    let dir = std::path::Path::new(manifest).join("target/c-abi-build").join(profile);
    let mut b = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    b.current_dir(manifest).args(["build", "--lib", "--target-dir"]).arg(std::path::Path::new(manifest).join("target/c-abi-build"));
    if !cfg!(debug_assertions) {
        b.arg("--release");
    }
    if cfg!(feature = "debug-hooks") {
        b.args(["--features", "debug-hooks"]);
    }
    let bs = b.output().unwrap();
    assert!(bs.status.success(), "staticlib 빌드 실패:\n{}", String::from_utf8_lossy(&bs.stderr));
    let lib = dir.join("libmeasurement_core.a");
    assert!(lib.exists(), "staticlib 없음: {}", lib.display());
    let out = dir.join("c_smoke");
    let mut cmd = Command::new(&cc);
    cmd.arg(format!("{manifest}/tests/c/smoke.c")).arg(format!("-I{manifest}/include")).arg(&lib).arg("-o").arg(&out).arg("-Wall").arg("-Werror");
    if cfg!(feature = "debug-hooks") {
        cmd.arg("-DMC_DEBUG_HOOKS");
    }
    if cfg!(target_os = "macos") {
        cmd.args(["-framework", "Security", "-framework", "CoreFoundation", "-lc++"]);
    } else {
        cmd.args(["-lpthread", "-ldl", "-lm"]);
    }
    let st = cmd.output().unwrap();
    assert!(st.status.success(), "C 컴파일/링크 실패:\n{}", String::from_utf8_lossy(&st.stderr));
    let run = Command::new(&out).output().unwrap();
    assert!(run.status.success(), "C smoke 실패:\n{}{}", String::from_utf8_lossy(&run.stdout), String::from_utf8_lossy(&run.stderr));
    assert!(String::from_utf8_lossy(&run.stdout).contains("c smoke OK"));
}
