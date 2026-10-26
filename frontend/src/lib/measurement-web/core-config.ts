// SDD-246 T06c — 웹 WASM 코어 설정(계약 CoreConfig). native(iOS MeasurementHost)와 같은 기본값을 쓴다.
// capture.start 의 device_profile/algorithm_version/model_version 은 반드시 이 값과 같아야 한다(서버 stream 기록 = 코어 산출 버전).
export const WEB_CORE_CONFIG = {
  abi_version: 1,
  device_profile_version: 'linkband2-v1',
  algorithm_version: 'web-ts-1',
  model_version: 'b0-cohort-2',
  model_hash: 'a'.repeat(64),
  model_mode: 'legacy_cohort',
  rates_hz: { eeg: 250, ppg: 50, acc: 30 },
  anchor: 'last_sample_web_v1',
  acc_interval_profile: 'rounded_33333us_v1',
} as const;

export const WEB_CORE_CONFIG_JSON = JSON.stringify(WEB_CORE_CONFIG);
