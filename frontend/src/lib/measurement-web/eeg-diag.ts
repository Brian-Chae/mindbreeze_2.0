// SDD-274 — 웹 WASM 경로 EEG 입력 진단(additive). PPG(ppg-diag)와 같은 방식으로 개수만 센다(민감값 없음).
// 코어 clock.rs admit 와 같은 식으로 장치 tick 누락(gap_samples)을 JS 에서 재계산해, 코어가 EEG 링을 비우고 재충전한 횟수(refill)를 추정한다.
// entry-state 쿼리 `ed` 로 서버 접근 로그에 남아 실기에서 EEG 알림 유실·순서 뒤바뀜을 확인한다.
export interface EegDiag {
  acc: number; dup: number; ooo: number; conf: number; inv: number; // 코어 판정(워커 1초 tick)
  pkts: number; stall: number; burst: number;                       // 알림 도착 모양
  gapSum: number; gapMax: number; refill: number; reset: number;    // 장치 tick 기준 누락
}

const TICK_HZ = 32_768;
const EEG_HZ = 250;
const GAP_SAMPLES_LIMIT = 2;
const RESET_BACK_TICKS = 2 * TICK_HZ;
const FORWARD_GAP_TICKS = 600 * TICK_HZ;

const zero = (): EegDiag => ({ acc: 0, dup: 0, ooo: 0, conf: 0, inv: 0, pkts: 0, stall: 0, burst: 0, gapSum: 0, gapMax: 0, refill: 0, reset: 0 });
let d: EegDiag = zero();
let lastArrUs: number | null = null;
let lastRaw: number | null = null;

/** EEG 알림 1건: 헤더 tick(uint32), 샘플 수, 도착 monotonic µs */
export function observeEegPacket(rawTick: number, nSamples: number, arrivalUs: number): void {
  d.pkts += 1;
  if (lastArrUs !== null) {
    const gap = arrivalUs - lastArrUs;
    if (gap > 1_500_000) d.stall += 1;
    else if (gap >= 0 && gap < 5_000) d.burst += 1;
  }
  lastArrUs = arrivalUs;
  if (lastRaw === null) { lastRaw = rawTick >>> 0; return; }
  const diff = ((rawTick >>> 0) - lastRaw) | 0; // wrapping_sub as i32
  if (diff === 0) return; // 같은 tick(중복/충돌)은 누락으로 세지 않는다
  if (diff < 0 && -diff <= RESET_BACK_TICKS) return; // 최근 과거 = out_of_order, 기준 tick 유지
  if (diff < 0 || diff > FORWARD_GAP_TICKS) { // tick reset(재연결·장치 재시작)
    d.reset += 1;
    lastRaw = rawTick >>> 0;
    return;
  }
  const gap = Math.floor((diff * EEG_HZ) / TICK_HZ - nSamples + 0.5);
  if (gap > 0) {
    d.gapSum += gap;
    if (gap > d.gapMax) d.gapMax = gap;
    if (gap > GAP_SAMPLES_LIMIT) d.refill += 1;
  }
  lastRaw = rawTick >>> 0;
}

export function setEegStatusTotals(t: Pick<EegDiag, 'acc' | 'dup' | 'ooo' | 'conf' | 'inv'>): void {
  d = { ...d, ...t };
}

export function resetEegDiag(): void {
  d = zero();
  lastArrUs = null;
  lastRaw = null;
}

export function eegDiagSnapshot(): EegDiag {
  return { ...d };
}

/** 예: a120.d0.o3.c0.i0.p125.s2.b40.g12.m5.r2.x1 (g 누락 합, m 최대 누락, r 재충전 추정, x tick reset) */
export function eegDiagCode(): string {
  return `a${d.acc}.d${d.dup}.o${d.ooo}.c${d.conf}.i${d.inv}.p${d.pkts}.s${d.stall}.b${d.burst}.g${d.gapSum}.m${d.gapMax}.r${d.refill}.x${d.reset}`;
}
