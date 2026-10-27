// EEG 분석 윈도 유효성 가드 (측정 가드).
// 정본: packages/measurement-core/src/guard.rs + guard-contract.md — 상수·판정 순서·reason 코드를 그대로 따른다.
// 포화·직류 계단·lead-off·불연속(갭)·이상치 윈도는 점수 산출 전에 걸러 EEG 지표를 명시적 null(invalid)로 낸다.
// 정상 신호는 어떤 규칙에도 걸리지 않아 기존 출력과 동일해야 한다.

import type { EEGDataPoint } from './SimpleCircularBuffer';

/** 판정 대상 = 링 끝의 최근 1000샘플(분석에 실제 쓰이는 최대 길이). */
export const GUARD_WINDOW = 1000;
/** 규칙 1: 포화 임계 = 24비트 풀스케일 µV 의 98%. */
export const SATURATION_FRACTION = 0.98;
/** 규칙 1: 포화 샘플(어느 채널이든) 비율이 이 값을 초과하면 무효. */
export const SATURATION_RATIO_LIMIT = 0.005;
/** 규칙 2: 인접 샘플 차 |Δ| 가 이 값(µV) 이상이면 계단 1회. */
export const STEP_UV = 3000;
/** 규칙 2: 채널별 계단 횟수가 이 값 이상이면 무효. */
export const STEP_COUNT_LIMIT = 3;
/** 규칙 3: lead-off 비트가 켜진 샘플(어느 채널이든) 비율이 이 값을 초과하면 무효. */
export const LEADOFF_RATIO_LIMIT = 0.05;
/** 규칙 4: 장치 tick 기준 누락 샘플 수가 이 값을 초과하면 갭. */
export const GAP_SAMPLES_LIMIT = 2;
/** 규칙 5: 위 규칙 통과 후에도 TNA 가 이 값을 넘으면 outlier. */
export const OUTLIER_TNA_LIMIT = 1000;

/** reason 코드(소문자 snake, 서버 정규식 통과). 코어 GuardReason::code 와 동일. */
export const GUARD_REASONS = ['saturated', 'step', 'leadoff', 'gap', 'outlier'] as const;
export type GuardReason = (typeof GUARD_REASONS)[number];

/** 서버 계약 validity 중 EEG 분석 결과가 쓰는 값. `pending` 은 서버 계약에 없어 신설하지 않는다. */
export type EegValidity = 'valid' | 'invalid';

const EEG_SAMPLE_RATE = 250;
/** 파서 풀스케일(24비트 signed, raw 8,388,607) → µV. blePacketParser/parser.rs 와 같은 식. */
const EEG_FULL_SCALE_RAW = 8_388_607;
const eegUv = (raw: number): number => ((raw * 4.033) / 12 / (Math.pow(2, 23) - 1)) * 1e6;

/** 포화 임계(µV): 파서 풀스케일의 98% (≈ 329,361). */
export function saturationThresholdUv(): number {
  return eegUv(EEG_FULL_SCALE_RAW) * SATURATION_FRACTION;
}

/**
 * 규칙 1~3 판정. 우선순위: saturated > step > leadoff. 정상이면 null.
 * 링 끝의 최근 GUARD_WINDOW 샘플만 본다.
 */
export function checkEegWindow(win: readonly EEGDataPoint[]): GuardReason | null {
  const tail = win.length > GUARD_WINDOW ? win.slice(win.length - GUARD_WINDOW) : win;
  const n = tail.length;
  if (n === 0) return null;
  const thr = saturationThresholdUv();
  let sat = 0;
  let lo = 0;
  let step1 = 0;
  let step2 = 0;
  for (let i = 0; i < n; i++) {
    const p = tail[i];
    if (Math.abs(p.fp1) >= thr || Math.abs(p.fp2) >= thr) sat++;
    if (p.leadOff?.ch1 || p.leadOff?.ch2) lo++;
    if (i > 0) {
      const q = tail[i - 1];
      if (Math.abs(p.fp1 - q.fp1) >= STEP_UV) step1++;
      if (Math.abs(p.fp2 - q.fp2) >= STEP_UV) step2++;
    }
  }
  if (sat > SATURATION_RATIO_LIMIT * n) return 'saturated';
  if (Math.max(step1, step2) >= STEP_COUNT_LIMIT) return 'step';
  if (lo > LEADOFF_RATIO_LIMIT * n) return 'leadoff';
  return null;
}

/** 규칙 5: TNA 가 한계를 넘거나 유한하지 않으면 outlier. */
export function isOutlierTna(tna: number): boolean {
  return !Number.isFinite(tna) || tna > OUTLIER_TNA_LIMIT;
}

/**
 * 규칙 4: 패킷 헤더 tick(장치 시각, 마지막 샘플 기준 초) 으로 누락 샘플을 추정한다.
 * 도착 시각은 쓰지 않는다 — BLE 콜백 지연·배치는 신호 유실이 아니다.
 * 누락 = round(경과초 × 250 − 패킷 샘플 수). 시각이 되돌아가면(카운터 리셋·재연결) 갭이 아니라 구간 리셋으로 보고 0.
 */
export class EegGapTracker {
  private lastDeviceSec: number | null = null;

  /** 패킷 1개를 관측하고 직전 패킷 대비 누락 샘플 수(≥0)를 돌려준다. 샘플이 없는 패킷은 무시(0). */
  observe(deviceTimestampSec: number, numSamples: number): number {
    if (!Number.isFinite(deviceTimestampSec) || numSamples <= 0) return 0;
    const prev = this.lastDeviceSec;
    this.lastDeviceSec = deviceTimestampSec;
    if (prev === null) return 0;
    const elapsed = deviceTimestampSec - prev;
    if (elapsed <= 0) return 0;
    return Math.max(0, Math.round(elapsed * EEG_SAMPLE_RATE - numSamples));
  }

  isGap(missingSamples: number): boolean {
    return missingSamples > GAP_SAMPLES_LIMIT;
  }

  reset(): void {
    this.lastDeviceSec = null;
  }
}
