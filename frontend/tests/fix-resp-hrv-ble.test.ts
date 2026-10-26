import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { StreamProcessor } from '../src/lib/eeg/StreamProcessor';
import { TimestampSynchronizer } from '../src/lib/eeg/TimestampSynchronizer';
import { parsePPGPacket } from '../src/lib/eeg/blePacketParser';

// 실제 BLE 경로 재현: 장치 시계(32768Hz) 패킷 → parsePPGPacket(타임스탬프 정규화) → StreamProcessor.
function sig(i: number) {
  const t = i / 50;
  const phase = 2 * Math.PI * (1.2 * t - (0.08 / (2 * Math.PI * 0.25)) * 1.2 * Math.cos(2 * Math.PI * 0.25 * t));
  const pulse = Math.max(0, Math.sin(phase)) ** 2;
  const drift = 3000 * Math.sin(2 * Math.PI * 0.02 * t) + 800 * Math.sin(2 * Math.PI * 0.25 * t);
  const noise = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 80;
  return { ir: Math.round(120000 + drift + 1500 * pulse + noise), red: Math.round(90000 + drift * 0.7 + 1000 * pulse + noise) };
}
function packet(startIdx: number, n: number, deviceSec: number) {
  const buf = new ArrayBuffer(4 + 6 * n); const dv = new DataView(buf);
  dv.setUint32(0, Math.round(deviceSec * 32768), true);
  for (let k = 0; k < n; k++) {
    const { ir, red } = sig(startIdx + k); const o = 4 + k * 6;
    dv.setUint8(o, (red >> 16) & 255); dv.setUint8(o + 1, (red >> 8) & 255); dv.setUint8(o + 2, red & 255);
    dv.setUint8(o + 3, (ir >> 16) & 255); dv.setUint8(o + 4, (ir >> 8) & 255); dv.setUint8(o + 5, ir & 255);
  }
  return dv;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_000_000)); (AnalysisMetricsService as unknown as { instance: null }).instance = null; vi.spyOn(console, 'log').mockImplementation(() => undefined); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('BLE 패킷 경로(타임스탬프 정규화 포함) 호흡·HRV', () => {
  for (const [name, jitter] of [['지터 없음', 0], ['도착 지터 ±120ms', 120]] as const) {
    it(`${name} — 150초 안에 SDNN·호흡이 값을 가진다`, async () => {
      const sp = new StreamProcessor(); const svc = AnalysisMetricsService.getInstance();
      const sync = new TimestampSynchronizer(); const counter = { samples: 0 };
      const N = 10; const rows: string[] = [];
      for (let s = 0; s < 150 * 50; s += N) {
        const dv = packet(s, N, (s + N) / 50);
        const parsed = parsePPGPacket(dv, sync, counter);
        const j = jitter ? Math.round((Math.sin(s * 0.37) * jitter)) : 0;
        await vi.advanceTimersByTimeAsync(N * 20 + (s % 7 === 0 ? j : -j / 6));
        sp.processPPGData(parsed.samples);
        if ((s / N) % 75 === 0) rows.push(`${Math.round(s / 50)}s rr=${svc.getRRBufferStatus().bufferLength} sdnn=${svc.getCurrentSDNN()} resp=${svc.getCurrentRespiratoryRate()} why=${svc.getRespiratoryNullReason()}`);
      }
      process.stdout.write(`\n[${name}]\n${rows.join('\n')}\n`);
      expect(svc.getCurrentSDNN()).not.toBeNull();
      expect(svc.getCurrentRespiratoryRate()).not.toBeNull();
    }, 120000);
  }
});
