/* 실제 C 컴파일러로 헤더+정적 라이브러리를 링크해 ABI 를 검증한다. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "measurement_core.h"

static const char *CFG = "{\"abi_version\":1,\"device_profile_version\":\"linkband2-v1\",\"algorithm_version\":\"web-ts-1\",\"model_version\":\"b0-cohort-2\",\"model_hash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"model_mode\":\"legacy_cohort\",\"rates_hz\":{\"eeg\":250,\"ppg\":50,\"acc\":30},\"anchor\":\"last_sample_web_v1\",\"acc_interval_profile\":\"rounded_33333us_v1\"}";

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "CHECK 실패 %s:%d %s\n", __FILE__, __LINE__, #c); return 1; } } while (0)

int main(void) {
  CHECK(mc_abi_version() == 1);
  McBuffer err = {0}; uint64_t h = 0;
  CHECK(mc_create((const uint8_t *)CFG, strlen(CFG), &h, &err) == 0 && h != 0);
  CHECK(err.data == NULL);

  /* PPG 1샘플 패킷: LE 헤더 0x00000000, red=1, ir=2 → 계약 core-push 와 같은 모양 */
  uint8_t pkt[10] = {0,0,0,0, 0,0,1, 0,0,2};
  McBuffer out = {0};
  CHECK(mc_push_packet_raw(h, 1, pkt, sizeof pkt, 1000000, 1760000000000ULL, 900000, &out) == 0);
  CHECK(out.data != NULL && out.len > 0);
  CHECK(strstr((const char *)out.data, "\"status\":\"accepted\"") != NULL);
  mc_buffer_free(&out);
  CHECK(out.data == NULL && out.len == 0);
  mc_buffer_free(&out); /* 이중 해제 안전 */
  mc_buffer_free(NULL);

  /* 잘린 패킷 → invalid_remainder, 원문 보존 표시 */
  uint8_t bad[12] = {0,0,0,0, 0,0,1, 0,0,2, 9, 9};
  CHECK(mc_push_packet_raw(h, 1, bad, sizeof bad, 2000000, 1760000000000ULL, 900000, &out) == 0);
  CHECK(strstr((const char *)out.data, "invalid_remainder") != NULL);
  CHECK(strstr((const char *)out.data, "\"raw_preserved\":true") != NULL);
  mc_buffer_free(&out);

  /* checkpoint → restore → 같은 config 로 새 핸들 */
  McBuffer ck = {0};
  CHECK(mc_checkpoint(h, &ck) == 0 && ck.len > 36);
  uint64_t h2 = 0;
  CHECK(mc_restore((const uint8_t *)CFG, strlen(CFG), ck.data, ck.len, &h2, &err) == 0 && h2 != 0 && h2 != h);
  ck.data[ck.len / 2] ^= 0xff;
  uint64_t h3 = 7;
  CHECK(mc_restore((const uint8_t *)CFG, strlen(CFG), ck.data, ck.len, &h3, &err) == MC_CHECKPOINT_CORRUPT && h3 == 0);
  CHECK(err.data != NULL && strstr((const char *)err.data, "checkpoint") != NULL);
  mc_buffer_free(&err); mc_buffer_free(&ck);

  /* 오류 코드 */
  CHECK(mc_push_packet_raw(999999, 1, pkt, sizeof pkt, 1, 1, 1, &out) == MC_INVALID_HANDLE);
  mc_buffer_free(&out);
  CHECK(mc_push_packet_raw(h, 9, pkt, sizeof pkt, 1, 1, 1, &out) == MC_INVALID_ARGUMENT);
  mc_buffer_free(&out);
  CHECK(mc_push_packet_raw(h, 1, NULL, 5, 1, 1, 1, &out) == MC_INVALID_ARGUMENT); /* len>0, ptr==NULL */
  mc_buffer_free(&out);
  const char *junk = "{\"abi_version\":2}";
  uint64_t h4 = 5;
  CHECK(mc_create((const uint8_t *)junk, strlen(junk), &h4, &err) == MC_INVALID_CONFIG && h4 == 0);
  mc_buffer_free(&err);

#ifdef MC_DEBUG_HOOKS
  CHECK(mc_debug_panic(&out) == MC_PANIC_CONTAINED); /* panic 이 프로세스를 죽이지 않음 */
  CHECK(strstr((const char *)out.data, "panic") != NULL);
  mc_buffer_free(&out);
#endif

  CHECK(mc_close(h, &out) == 0);
  CHECK(strstr((const char *)out.data, "raw_sha256") != NULL);
  mc_buffer_free(&out);
  CHECK(mc_close(h, &out) == MC_INVALID_HANDLE); /* 해제 후 재사용 거절 */
  mc_buffer_free(&out);
  CHECK(mc_destroy(h2) == 0);
  CHECK(mc_destroy(h2) == MC_INVALID_HANDLE);
  puts("c smoke OK");
  return 0;
}
