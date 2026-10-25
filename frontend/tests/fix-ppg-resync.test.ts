import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { StreamProcessor } from '../src/lib/eeg/StreamProcessor';
import { TimestampSynchronizer } from '../src/lib/eeg/TimestampSynchronizer';
import { parseACCPacket, parseEEGPacket, parsePPGPacket } from '../src/lib/eeg/blePacketParser';

// 실측(Android + LINK BAND) 재현: EEG 25샘플/100ms, PPG 28샘플/560ms, ACC 30샘플/1s 패킷이
// 하나의 장치 시계(32768Hz)로 뒤섞여 도착하고, 도착 시각에 BLE 지터(±25ms)가 있다.
// 같은 TimestampSynchronizer 하나를 세 센서가 공유한다(bluetoothService.ts:163).

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
  dv.setUint32(0, Math.round(deviceSec * CLOCK), false);
  for (let k = 0; k < n; k++) {
    const { ir, red } = sig(startIdx + k); const o = 4 + k * 6;
    dv.setUint8(o, (red >> 16) & 255); dv.setUint8(o + 1, (red >> 8) & 255); dv.setUint8(o + 2, red & 255);
    dv.setUint8(o + 3, (ir >> 16) & 255); dv.setUint8(o + 4, (ir >> 8) & 255); dv.setUint8(o + 5, ir & 255);
  }
  return dv;
}
function eegPacket(n: number, deviceSec: number) {
  const dv = new DataView(new ArrayBuffer(4 + 7 * n));
  dv.setUint32(0, Math.round(deviceSec * CLOCK), true);
  return dv;
}
function accPacket(n: number, deviceSec: number) {
  const dv = new DataView(new ArrayBuffer(4 + 6 * n));
  dv.setUint32(0, Math.round(deviceSec * CLOCK), true);
  return dv;
}
// 결정적 의사난수 지터 (-1..1)
function rnd(k: number) { const x = Math.sin(k * 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

interface Ev { arrive: number; kind: 'eeg' | 'ppg' | 'acc'; dev: number; start: number }
function buildEvents(seconds: number, jitterMs: number): Ev[] {
  const ev: Ev[] = [];
  let k = 0;
  for (let p = 1; p * 0.1 <= seconds; p++) ev.push({ kind: 'eeg', dev: p * 0.1, arrive: p * 100 + rnd(k++) * jitterMs, start: 0 });
  for (let p = 1; p * 0.56 <= seconds; p++) ev.push({ kind: 'ppg', dev: p * 0.56, arrive: p * 560 + rnd(k++) * jitterMs, start: (p - 1) * 28 });
  for (let p = 1; p <= seconds; p++) ev.push({ kind: 'acc', dev: p, arrive: p * 1000 + rnd(k++) * jitterMs, start: 0 });
  return ev.sort((a, b) => a.arrive - b.arrive);
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(1_000_000));
  (AnalysisMetricsService as unknown as { instance: null }).instance = null;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('BLE 3센서 혼합 + 도착 지터에서 시간축 재동기화', () => {
  for (const jitter of [0, 25]) {
    it(`지터 ±${jitter}ms — 150초 안에 SDNN·호흡 산출, 재동기화 폭주 없음, 샘플 시각 단조`, async () => {
      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(String(a[0])); });
      const sp = new StreamProcessor(); const svc = AnalysisMetricsService.getInstance();
      const sync = new TimestampSynchronizer();
      const cnt = { samples: 0 };
      let lastAcc = 0; let accN = 0;
      const ppgTs: number[] = []; const eegTs: number[] = []; const accTs: number[] = [];
      const rows: string[] = [];
      let now = 0;
      for (const e of buildEvents(150, jitter)) {
        await vi.advanceTimersByTimeAsync(Math.max(0, Math.round(e.arrive) - now));
        now = Math.max(now, Math.round(e.arrive));
        if (e.kind === 'ppg') {
          const r = parsePPGPacket(ppgPacket(e.start, 28, e.dev), sync, cnt);
          r.samples.forEach(s => ppgTs.push(s.timestamp));
          sp.processPPGData(r.samples);
        } else if (e.kind === 'eeg') {
          eegPacket(25, e.dev);
          parseEEGPacket(eegPacket(25, e.dev), sync, cnt).samples.forEach(s => eegTs.push(s.timestamp));
        } else {
          const r = parseACCPacket(accPacket(30, e.dev), sync, cnt, lastAcc, accN);
          lastAcc = r.newLastTimestamp; accN = r.newPacketCount;
          r.samples.forEach(s => accTs.push(s.timestamp));
        }
        if (e.kind === 'ppg' && Math.round(e.dev) % 30 === 0 && Math.abs(e.dev - Math.round(e.dev)) < 0.3) {
          rows.push(`${Math.round(e.dev)}s sdnn=${svc.getCurrentSDNN()} resp=${svc.getCurrentRespiratoryRate()} why=${svc.getRespiratoryNullReason()}`);
        }
      }
      const resyncs = logs.filter(l => l.includes('재동기화')).length;
      const backwards = (a: number[]) => a.filter((t, i) => i > 0 && t <= a[i - 1]).length;
      const maxStep = (a: number[], nominal: number) => a.reduce((m, t, i) => (i > 0 ? Math.max(m, Math.abs(t - a[i - 1] - nominal)) : m), 0);
      process.stdout.write(`\n[jitter ${jitter}] resync=${resyncs} ppgBackward=${backwards(ppgTs)} eegBackward=${backwards(eegTs)} accBackward=${backwards(accTs)} ppgMaxStepErr=${maxStep(ppgTs, 20).toFixed(1)}ms eegMaxStepErr=${maxStep(eegTs, 4).toFixed(1)}ms\n${rows.join('\n')}\n`);

      // 150초 동안 5초 주기 재동기화 상한(30회) 이내여야 한다.
      expect(resyncs).toBeLessThanOrEqual(30);
      // 샘플 시각은 단조 증가 + 고정 샘플레이트 간격(오차 < 10ms)을 유지해야 한다.
      expect(backwards(ppgTs)).toBe(0);
      expect(backwards(eegTs)).toBe(0);
      expect(maxStep(ppgTs, 20)).toBeLessThan(10);
      expect(maxStep(eegTs, 4)).toBeLessThan(10);
      expect(svc.getCurrentSDNN()).not.toBeNull();
      expect(svc.getCurrentRespiratoryRate()).not.toBeNull();
    }, 180000);
  }
});
