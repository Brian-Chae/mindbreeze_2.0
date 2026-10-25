import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { StreamProcessor } from '../src/lib/eeg/StreamProcessor';
import { TimestampSynchronizer } from '../src/lib/eeg/TimestampSynchronizer';
import { parsePPGPacket } from '../src/lib/eeg/blePacketParser';

// 실기기 실측: 같은 패킷이 2회 전달(네이티브 알림 중복)되고, 센서별 장치 시계 원점이 달라
// 공유 매핑이면 PPG 시각이 +25.7시간 미래로 튀어 RR 버퍼가 1건에서 멈췄다.
const CLOCK = 32768;
function sig(i: number) {
  const t = i / 50;
  const phase = 2 * Math.PI * (1.2 * t - (0.08 / (2 * Math.PI * 0.25)) * 1.2 * Math.cos(2 * Math.PI * 0.25 * t));
  const pulse = Math.max(0, Math.sin(phase)) ** 2;
  const drift = 3000 * Math.sin(2 * Math.PI * 0.02 * t) + 800 * Math.sin(2 * Math.PI * 0.25 * t);
  const noise = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 80;
  return { ir: Math.round(120000 + drift + 1500 * pulse + noise), red: Math.round(90000 + drift * 0.7 + 1000 * pulse + noise) };
}
function ppgPacket(startIdx: number, n: number, deviceSec: number) {
  const dv = new DataView(new ArrayBuffer(4 + 6 * n));
  dv.setUint32(0, Math.round(deviceSec * CLOCK), true);
  for (let k = 0; k < n; k++) {
    const { ir, red } = sig(startIdx + k); const o = 4 + k * 6;
    dv.setUint8(o, (red >> 16) & 255); dv.setUint8(o + 1, (red >> 8) & 255); dv.setUint8(o + 2, red & 255);
    dv.setUint8(o + 3, (ir >> 16) & 255); dv.setUint8(o + 4, (ir >> 8) & 255); dv.setUint8(o + 5, ir & 255);
  }
  return dv;
}
function eegHeader(deviceSec: number) {
  const dv = new DataView(new ArrayBuffer(4 + 7 * 25)); dv.setUint32(0, Math.round(deviceSec * CLOCK), true); return dv;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(1_000_000_000));
  (AnalysisMetricsService as unknown as { instance: null }).instance = null;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function run(opts: { dup: boolean; ppgOriginSec: number; seconds: number }) {
  const sp = new StreamProcessor(); const svc = AnalysisMetricsService.getInstance();
  const sync = new TimestampSynchronizer(); const cnt = { samples: 0 };
  let total = 0; const ts: number[] = [];
  const N = 28; const rows: string[] = [];
  // EEG 첫 패킷으로 EEG 시계를 먼저 앵커링(공유 매핑이면 PPG 가 이 원점을 따라간다)
  await import('../src/lib/eeg/blePacketParser').then(m => m.parseEEGPacket(eegHeader(0.1), sync, cnt));
  for (let s = 0, p = 1; s < opts.seconds * 50; s += N, p++) {
    await vi.advanceTimersByTimeAsync(N * 20);
    const dv = ppgPacket(s, N, opts.ppgOriginSec + p * N / 50);
    for (let rep = 0; rep < (opts.dup ? 2 : 1); rep++) {
      const r = parsePPGPacket(dv, sync, cnt);
      total += r.samples.length; r.samples.forEach(x => ts.push(x.timestamp));
      sp.processPPGData(r.samples);
    }
    if (p % 54 === 0) rows.push(`${Math.round(s / 50)}s rr=${svc.getRRBufferStatus().bufferLength} sdnn=${svc.getCurrentSDNN()} resp=${svc.getCurrentRespiratoryRate()} why=${svc.getRespiratoryNullReason()}`);
  }
  process.stdout.write(`\n[dup=${opts.dup} origin=${opts.ppgOriginSec}] samples=${total} (명목 ${opts.seconds * 50}) maxTsAheadOfNowSec=${Math.round((Math.max(...ts) - Date.now()) / 1000)}\n${rows.join('\n')}\n`);
  return { svc, total, ts };
}

describe('Native 중복 패킷 + 센서별 시계 원점 차이', () => {
  it('같은 PPG 패킷이 2회 전달돼도 샘플 수가 명목과 같고 90초 안에 SDNN·호흡이 산출된다', async () => {
    const { svc, total } = await run({ dup: true, ppgOriginSec: 0, seconds: 150 });
    expect(total).toBeLessThanOrEqual(150 * 50 + 28);
    expect(svc.getCurrentSDNN()).not.toBeNull();
    expect(svc.getCurrentRespiratoryRate()).not.toBeNull();
  }, 180000);

  it('PPG 장치 시계 원점이 EEG 와 25.7시간 달라도 PPG 시각이 현재 근처이고 SDNN·호흡이 산출된다', async () => {
    const { svc, ts } = await run({ dup: false, ppgOriginSec: 92_400, seconds: 150 });
    expect(Math.abs(Math.max(...ts) - Date.now())).toBeLessThan(10_000);
    expect(svc.getCurrentSDNN()).not.toBeNull();
    expect(svc.getCurrentRespiratoryRate()).not.toBeNull();
  }, 180000);
});

describe('AnalysisMetricsService 미래 타임스탬프 방어', () => {
  it('미래로 튄 RR 시각 1건을 주입해도 이후 정상 박동으로 회복한다', async () => {
    const svc = AnalysisMetricsService.getInstance() as unknown as { updateRRIntervalBuffer(rr: number[], ts: number[]): void };
    const t0 = Date.now();
    svc.updateRRIntervalBuffer([800], [t0 + 92_400_000]); // +25.7시간
    for (let i = 0; i < 40; i++) {
      vi.setSystemTime(t0 + 1000 + i * 800);
      svc.updateRRIntervalBuffer([800], [t0 + 1000 + i * 800]);
    }
    const status = AnalysisMetricsService.getInstance().getRRBufferStatus();
    expect(status.bufferLength).toBeGreaterThanOrEqual(30);
  });
});
