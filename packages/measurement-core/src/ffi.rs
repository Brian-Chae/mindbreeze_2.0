//! C ABI (cbindgen → include/measurement_core.h).
//!
//! 계약
//! - 반환값: `McStatus`(0=ok). 실패 시 `out` 에 `{"code","message"}` JSON 이 채워진다(null 이면 생략).
//! - 소유권: `McBuffer` 는 코어가 할당해 호출자에게 넘긴다. 반드시 `mc_buffer_free` 로 1회 해제(이중 해제·null 안전).
//!   입력 포인터는 호출 동안만 빌리며 코어가 보관하지 않는다.
//! - 핸들: 0 이 아닌 불투명 u64. 해제된/미지의 핸들은 `MC_INVALID_HANDLE`. 같은 핸들 동시 호출은 직렬화된다.
//! - panic: 모든 진입점이 `catch_unwind` 로 감싸며 FFI 를 넘지 않는다(`MC_PANIC_CONTAINED`).
//! - 길이: 모든 (ptr,len) 쌍은 len==0 이면 ptr 이 null 이어도 된다. 입력 상한 1MiB.

use crate::api::*;
use crate::engine::{Core, ErrorCode, Tuning};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub const MAX_INPUT: usize = 1 << 20;

/// 코어가 소유하는 결과 버퍼. `mc_buffer_free` 로만 해제한다.
#[repr(C)]
pub struct McBuffer {
    pub data: *mut u8,
    pub len: usize,
}

/// 상태 코드 — 값은 안정(ABI). 계약 CoreError.code 와 이름이 대응한다.
#[repr(i32)]
#[derive(Clone, Copy)]
#[allow(non_camel_case_types)]
pub enum McStatus {
    MC_OK = 0,
    MC_INVALID_HANDLE = 1,
    MC_BUFFER_TOO_SMALL = 2,
    MC_INVALID_CONFIG = 3,
    MC_CHECKPOINT_CORRUPT = 4,
    MC_PANIC_CONTAINED = 5,
    MC_OOM = 6,
    MC_INVALID_ARGUMENT = 7,
}

fn registry() -> &'static Mutex<HashMap<u64, Arc<Mutex<Core>>>> {
    static R: OnceLock<Mutex<HashMap<u64, Arc<Mutex<Core>>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}
static NEXT: AtomicU64 = AtomicU64::new(1);

fn put(out: *mut McBuffer, bytes: Vec<u8>) {
    if out.is_null() {
        return;
    }
    let b = bytes.into_boxed_slice();
    let len = b.len();
    let ptr = Box::into_raw(b) as *mut u8;
    unsafe {
        (*out).data = ptr;
        (*out).len = len;
    }
}

fn clear(out: *mut McBuffer) {
    if !out.is_null() {
        unsafe {
            (*out).data = std::ptr::null_mut();
            (*out).len = 0;
        }
    }
}

fn slice<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], ApiError> {
    if len > MAX_INPUT {
        return Err(ApiError::new(ErrorCode::InvalidArgument, "입력이 1MiB 를 넘음"));
    }
    if len == 0 {
        return Ok(&[]);
    }
    if ptr.is_null() {
        return Err(ApiError::new(ErrorCode::InvalidArgument, "null 포인터"));
    }
    Ok(unsafe { std::slice::from_raw_parts(ptr, len) })
}

fn fail(out: *mut McBuffer, e: ApiError) -> i32 {
    put(out, e.to_json().into_bytes());
    e.code as i32
}

/// 공통 실행기: panic 격리 + 핸들 조회 + 결과 기록
fn run<F>(handle: u64, out: *mut McBuffer, f: F) -> i32
where
    F: FnOnce(&mut Core) -> Result<Option<String>, ApiError>,
{
    clear(out);
    let r = catch_unwind(AssertUnwindSafe(|| {
        let core = {
            let g = registry().lock().map_err(|_| ApiError::new(ErrorCode::PanicContained, "registry poisoned"))?;
            g.get(&handle).cloned().ok_or_else(|| ApiError::new(ErrorCode::InvalidHandle, "알 수 없는/해제된 핸들"))?
        };
        let mut c = core.lock().map_err(|_| ApiError::new(ErrorCode::PanicContained, "core 상태 손상(이전 panic)"))?;
        f(&mut c)
    }));
    match r {
        Ok(Ok(Some(json))) => {
            put(out, json.into_bytes());
            0
        }
        Ok(Ok(None)) => 0,
        Ok(Err(e)) => fail(out, e),
        Err(_) => fail(out, ApiError::new(ErrorCode::PanicContained, "내부 panic 격리됨")),
    }
}

fn register(core: Core) -> u64 {
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    registry().lock().unwrap().insert(id, Arc::new(Mutex::new(core)));
    id
}

/// ABI 버전(계약 CoreConfig.abi_version 과 같아야 함)
#[no_mangle]
pub extern "C" fn mc_abi_version() -> u32 {
    crate::engine::ABI_VERSION
}

/// 코어 생성. `config_json` = 계약 CoreConfig. 성공 시 `*out_handle` != 0.
#[no_mangle]
pub unsafe extern "C" fn mc_create(config_json: *const u8, config_len: usize, out_handle: *mut u64, out_err: *mut McBuffer) -> i32 {
    clear(out_err);
    if out_handle.is_null() {
        return fail(out_err, ApiError::new(ErrorCode::InvalidArgument, "out_handle null"));
    }
    *out_handle = 0;
    let r = catch_unwind(AssertUnwindSafe(|| -> Result<u64, ApiError> {
        let cfg = parse_config(slice(config_json, config_len)?)?;
        let core = Core::with_tuning(cfg, Tuning::default()).map_err(|m| ApiError::new(ErrorCode::InvalidConfig, m))?;
        Ok(register(core))
    }));
    match r {
        Ok(Ok(h)) => {
            *out_handle = h;
            0
        }
        Ok(Err(e)) => fail(out_err, e),
        Err(_) => fail(out_err, ApiError::new(ErrorCode::PanicContained, "내부 panic 격리됨")),
    }
}

/// 체크포인트로 복원. config 가 체크포인트를 만든 config 와 다르면 `MC_CHECKPOINT_CORRUPT`.
#[no_mangle]
pub unsafe extern "C" fn mc_restore(config_json: *const u8, config_len: usize, ck: *const u8, ck_len: usize, out_handle: *mut u64, out_err: *mut McBuffer) -> i32 {
    clear(out_err);
    if out_handle.is_null() {
        return fail(out_err, ApiError::new(ErrorCode::InvalidArgument, "out_handle null"));
    }
    *out_handle = 0;
    let r = catch_unwind(AssertUnwindSafe(|| -> Result<u64, ApiError> {
        let cfg = parse_config(slice(config_json, config_len)?)?;
        let bytes = {
            if ck_len > 64 * MAX_INPUT {
                return Err(ApiError::new(ErrorCode::InvalidArgument, "checkpoint 64MiB 초과"));
            }
            if ck_len == 0 || ck.is_null() {
                return Err(ApiError::new(ErrorCode::CheckpointCorrupt, "빈 checkpoint"));
            }
            std::slice::from_raw_parts(ck, ck_len)
        };
        let core = Core::restore(cfg, bytes).map_err(|m| ApiError::new(ErrorCode::CheckpointCorrupt, m))?;
        Ok(register(core))
    }));
    match r {
        Ok(Ok(h)) => {
            *out_handle = h;
            0
        }
        Ok(Err(e)) => fail(out_err, e),
        Err(_) => fail(out_err, ApiError::new(ErrorCode::PanicContained, "내부 panic 격리됨")),
    }
}

/// 활성 sigmoid 모델 params(JSON) 주입. 수업 시작에 한 번, 도중 교체 금지(호출자 책임).
#[no_mangle]
pub unsafe extern "C" fn mc_set_model(handle: u64, model_json: *const u8, len: usize, out: *mut McBuffer) -> i32 {
    run(handle, out, |c| {
        set_model_json(c, slice(model_json, len)?)?;
        Ok(None)
    })
}

/// 계약 PushPacketCall(JSON) → 계약 CoreOutput(JSON)
#[no_mangle]
pub unsafe extern "C" fn mc_push_packet(handle: u64, call_json: *const u8, len: usize, out: *mut McBuffer) -> i32 {
    run(handle, out, |c| Ok(Some(push_json(c, slice(call_json, len)?)?)))
}

/// base64 없이 바이너리 직접 투입(네이티브 BLE 콜백 경로). sensor: 0=eeg 1=ppg 2=acc.
#[no_mangle]
pub unsafe extern "C" fn mc_push_packet_raw(handle: u64, sensor: u8, bytes: *const u8, len: usize, arrival_monotonic_us: u64, wall_ms: u64, anchor_monotonic_us: u64, out: *mut McBuffer) -> i32 {
    run(handle, out, |c| Ok(Some(push_raw(c, sensor, slice(bytes, len)?, arrival_monotonic_us, wall_ms, anchor_monotonic_us)?)))
}

/// 시간 경과 처리 → MetricFrame[] JSON (공백 3초↑ 시 gap 프레임)
#[no_mangle]
pub unsafe extern "C" fn mc_advance(handle: u64, monotonic_us: u64, out: *mut McBuffer) -> i32 {
    run(handle, out, |c| Ok(Some(advance_json(c, monotonic_us))))
}

/// 체크포인트 바이트(불투명, 무결성 해시 포함) 생성
#[no_mangle]
pub unsafe extern "C" fn mc_checkpoint(handle: u64, out: *mut McBuffer) -> i32 {
    clear(out);
    let r = catch_unwind(AssertUnwindSafe(|| -> Result<Vec<u8>, ApiError> {
        let core = registry().lock().map_err(|_| ApiError::new(ErrorCode::PanicContained, "registry poisoned"))?.get(&handle).cloned().ok_or_else(|| ApiError::new(ErrorCode::InvalidHandle, "알 수 없는/해제된 핸들"))?;
        let c = core.lock().map_err(|_| ApiError::new(ErrorCode::PanicContained, "core 손상"))?;
        Ok(c.checkpoint())
    }));
    match r {
        Ok(Ok(b)) => {
            put(out, b);
            0
        }
        Ok(Err(e)) => fail(out, e),
        Err(_) => fail(out, ApiError::new(ErrorCode::PanicContained, "내부 panic 격리됨")),
    }
}

/// 세션 종료: FinalManifest JSON 을 돌려주고 핸들을 해제한다.
#[no_mangle]
pub unsafe extern "C" fn mc_close(handle: u64, out: *mut McBuffer) -> i32 {
    let st = run(handle, out, |c| Ok(Some(close_json(c))));
    if st == 0 {
        if let Ok(mut g) = registry().lock() {
            g.remove(&handle);
        }
    }
    st
}

/// 마감 없이 핸들만 폐기(중단 경로)
#[no_mangle]
pub extern "C" fn mc_destroy(handle: u64) -> i32 {
    match catch_unwind(|| registry().lock().map(|mut g| g.remove(&handle).is_some())) {
        Ok(Ok(true)) => 0,
        Ok(Ok(false)) => McStatus::MC_INVALID_HANDLE as i32,
        _ => McStatus::MC_PANIC_CONTAINED as i32,
    }
}

/// `McBuffer` 해제. null/이미 비운 버퍼는 무시한다(이중 해제 안전).
#[no_mangle]
pub unsafe extern "C" fn mc_buffer_free(buf: *mut McBuffer) {
    if buf.is_null() {
        return;
    }
    let b = &mut *buf;
    if !b.data.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(b.data, b.len)));
    }
    b.data = std::ptr::null_mut();
    b.len = 0;
}

/// 테스트 전용(feature `debug-hooks`): 의도적 panic 이 FFI 를 넘지 않는지 검증
#[cfg(feature = "debug-hooks")]
#[no_mangle]
pub unsafe extern "C" fn mc_debug_panic(out: *mut McBuffer) -> i32 {
    clear(out);
    match catch_unwind(|| -> () { panic!("debug panic") }) {
        Ok(_) => 0,
        Err(_) => fail(out, ApiError::new(ErrorCode::PanicContained, "내부 panic 격리됨")),
    }
}
