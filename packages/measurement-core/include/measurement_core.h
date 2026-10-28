/* MIND BREEZE measurement-core C ABI (SDD-246 T02). 자동 생성 — 수정 금지(cbindgen). */

#ifndef MEASUREMENT_CORE_H
#define MEASUREMENT_CORE_H

#include <stdint.h>
#include <stddef.h>

// 가드 강제 여부. false(기록만) = 판정 사유는 프레임 지표의 `reason` 과 GuardStats 에 남기되
// 정상 산출한 지표값을 null 로 지우지 않는다(2026-10-28 대표 결정). true 로 되돌리면 무효 창 지표를 invalid(null)로 낸다.
// 단 갭(Gap)은 분석 자체가 없어 값이 존재하지 않으므로 이 플래그와 무관하게 invalid 다.
// 웹 TS 의 GUARD_ENFORCE(measureGuard.ts) 와 같은 값으로 유지한다.
#define GUARD_ENFORCE false

// 상태 코드 — 값은 안정(ABI). 계약 CoreError.code 와 이름이 대응한다.
enum McStatus
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : int32_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  MC_OK = 0,
  MC_INVALID_HANDLE = 1,
  MC_BUFFER_TOO_SMALL = 2,
  MC_INVALID_CONFIG = 3,
  MC_CHECKPOINT_CORRUPT = 4,
  MC_PANIC_CONTAINED = 5,
  MC_OOM = 6,
  MC_INVALID_ARGUMENT = 7,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum McStatus McStatus;
#else
typedef int32_t McStatus;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

// 코어가 소유하는 결과 버퍼. `mc_buffer_free` 로만 해제한다.
typedef struct McBuffer {
  uint8_t *data;
  size_t len;
} McBuffer;

#ifdef __cplusplus
extern "C" {
#endif // __cplusplus

// ABI 버전(계약 CoreConfig.abi_version 과 같아야 함)
uint32_t mc_abi_version(void);

// 코어 생성. `config_json` = 계약 CoreConfig. 성공 시 `*out_handle` != 0.
int32_t mc_create(const uint8_t *config_json,
                  size_t config_len,
                  uint64_t *out_handle,
                  struct McBuffer *out_err);

// 체크포인트로 복원. config 가 체크포인트를 만든 config 와 다르면 `MC_CHECKPOINT_CORRUPT`.
int32_t mc_restore(const uint8_t *config_json,
                   size_t config_len,
                   const uint8_t *ck,
                   size_t ck_len,
                   uint64_t *out_handle,
                   struct McBuffer *out_err);

// 활성 sigmoid 모델 params(JSON) 주입. 수업 시작에 한 번, 도중 교체 금지(호출자 책임).
int32_t mc_set_model(uint64_t handle,
                     const uint8_t *model_json,
                     size_t len,
                     struct McBuffer *out);

// 계약 PushPacketCall(JSON) → 계약 CoreOutput(JSON)
int32_t mc_push_packet(uint64_t handle, const uint8_t *call_json, size_t len, struct McBuffer *out);

// base64 없이 바이너리 직접 투입(네이티브 BLE 콜백 경로). sensor: 0=eeg 1=ppg 2=acc.
int32_t mc_push_packet_raw(uint64_t handle,
                           uint8_t sensor,
                           const uint8_t *bytes,
                           size_t len,
                           uint64_t arrival_monotonic_us,
                           uint64_t wall_ms,
                           uint64_t anchor_monotonic_us,
                           struct McBuffer *out);

// 시간 경과 처리 → MetricFrame[] JSON (공백 3초↑ 시 gap 프레임)
int32_t mc_advance(uint64_t handle, uint64_t monotonic_us, struct McBuffer *out);

// 체크포인트 바이트(불투명, 무결성 해시 포함) 생성
int32_t mc_checkpoint(uint64_t handle, struct McBuffer *out);

// 세션 종료: FinalManifest JSON 을 돌려주고 핸들을 해제한다.
int32_t mc_close(uint64_t handle, struct McBuffer *out);

// 마감 없이 핸들만 폐기(중단 경로)
int32_t mc_destroy(uint64_t handle);

// `McBuffer` 해제. null/이미 비운 버퍼는 무시한다(이중 해제 안전).
void mc_buffer_free(struct McBuffer *buf);

#if defined(MC_DEBUG_HOOKS)
// 테스트 전용(feature `debug-hooks`): 의도적 panic 이 FFI 를 넘지 않는지 검증
int32_t mc_debug_panic(struct McBuffer *out);
#endif

#ifdef __cplusplus
}  // extern "C"
#endif  // __cplusplus

#endif  /* MEASUREMENT_CORE_H */
