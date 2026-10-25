//! cbindgen 으로 include/measurement_core.h 를 갱신한다. 헤더 생성 실패는 빌드를 막지 않는다
//! (크로스 빌드 환경에서 cargo metadata 를 못 쓰는 경우) — 헤더 일치는 tests/c_abi.rs 가 검증한다.
fn main() {
    println!("cargo:rerun-if-changed=src/ffi.rs");
    println!("cargo:rerun-if-changed=cbindgen.toml");
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let cfg = cbindgen::Config::from_file(format!("{dir}/cbindgen.toml")).unwrap_or_default();
    match cbindgen::Builder::new().with_crate(&dir).with_config(cfg).generate() {
        Ok(b) => {
            let out = std::path::Path::new(&dir).join("include/measurement_core.h");
            let mut buf = Vec::new();
            b.write(&mut buf);
            if std::fs::read(&out).map(|old| old != buf).unwrap_or(true) {
                let _ = std::fs::create_dir_all(out.parent().unwrap());
                let _ = std::fs::write(&out, buf);
            }
        }
        Err(e) => println!("cargo:warning=cbindgen 생략: {e}"),
    }
}
