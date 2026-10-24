import type { Rate } from './raw-types';

function roundedRatio(n: bigint, d: bigint): bigint {
  const sign = n < 0n ? -1n : 1n;
  const absolute = n * sign;
  const quotient = absolute / d;
  const remainder = absolute % d;
  // Python round/Fraction과 같은 ties-to-even. 누적 반올림은 하지 않는다.
  return sign * (quotient + (remainder * 2n > d || (remainder * 2n === d && quotient % 2n !== 0n) ? 1n : 0n));
}

export function sampleTimeUs(sampleIndex: number, rate: Rate, anchorIndex = 0, anchorUs = '0'): string {
  if (!Number.isSafeInteger(sampleIndex) || !Number.isSafeInteger(anchorIndex) ||
      !Number.isSafeInteger(rate.numerator) || !Number.isSafeInteger(rate.denominator) || rate.numerator <= 0 || rate.denominator <= 0) {
    throw new Error('invalid_sample_clock');
  }
  const n = BigInt(anchorUs) * BigInt(rate.numerator) + BigInt(sampleIndex - anchorIndex) * 1000000n * BigInt(rate.denominator);
  return roundedRatio(n, BigInt(rate.numerator)).toString();
}

export interface ClockObservation {
  segmentId: string; rawTick: string; unwrappedTick: string; mappedUtcUs: string;
  reason: 'clock_reset' | 'wall_clock_jump' | 'reanchor' | null;
}

/** 웹 프로필의 추정 clock. 원 tick/arrival은 보존하며 UTC 검증을 주장하지 않는다. */
export class BiosignalClock {
  private segmentId: string;
  private lastRaw: number | null = null;
  private wraps = 0n;
  private lastWall = 0n;
  private lastMono = 0n;
  private anchorTick = 0n;
  private anchorWall = 0n;
  private pendingReanchor = false;
  private createId: () => string;
  constructor(createId: () => string = () => crypto.randomUUID()) {
    this.createId = createId;
    this.segmentId = createId();
  }
  reanchor(): void { this.pendingReanchor = true; }
  observe(rawTick: number, receivedUtcUs: string, receivedMonotonicUs: string): ClockObservation {
    if (!Number.isInteger(rawTick) || rawTick < 0 || rawTick >= 2 ** 32) throw new Error('invalid_device_tick');
    const wall = BigInt(receivedUtcUs), mono = BigInt(receivedMonotonicUs);
    let reason: ClockObservation['reason'] = this.pendingReanchor ? 'reanchor' : null;
    if (this.lastRaw !== null) {
      const wallDelta = wall - this.lastWall - (mono - this.lastMono);
      if (wallDelta > 1000000n || wallDelta < -1000000n || mono < this.lastMono) reason = 'wall_clock_jump';
      if (rawTick > this.lastRaw && reason === null) {
        const tickDeltaUs = roundedRatio(BigInt(rawTick - this.lastRaw) * 1000000n, 32768n);
        const discrepancy = tickDeltaUs - (mono - this.lastMono);
        if (discrepancy > 1000000n || discrepancy < -1000000n) reason = 'reanchor';
      }
      if (rawTick < this.lastRaw) {
        const wrappedDeltaUs = roundedRatio((BigInt(rawTick) + (1n << 32n) - BigInt(this.lastRaw)) * 1000000n, 32768n);
        const mismatch = wrappedDeltaUs - (mono - this.lastMono);
        if (this.lastRaw > 0xf0000000 && rawTick < 0x10000000 && mismatch <= 1000000n && mismatch >= -1000000n) this.wraps += 1n;
        else reason = 'clock_reset';
      }
    }
    if (reason) { this.segmentId = this.createId(); this.wraps = 0n; }
    const tick = this.wraps * (1n << 32n) + BigInt(rawTick);
    if (reason || this.lastRaw === null) { this.anchorTick = tick; this.anchorWall = wall; }
    this.lastRaw = rawTick; this.lastWall = wall; this.lastMono = mono; this.pendingReanchor = false;
    return { segmentId: this.segmentId, rawTick: String(rawTick), unwrappedTick: tick.toString(),
      mappedUtcUs: (this.anchorWall + roundedRatio((tick - this.anchorTick) * 1000000n, 32768n)).toString(), reason };
  }
}
