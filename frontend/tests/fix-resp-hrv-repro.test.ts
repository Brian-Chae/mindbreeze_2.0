import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { StreamProcessor } from '../src/lib/eeg/StreamProcessor';

// 실측에 가까운 PPG: 심박 72bpm + RSA(0.25Hz) + 호흡 기저선 변동 + 느린 드리프트 + 잡음, 50Hz, 패킷당 N샘플
function ppgSample(i: number, base: number) {
  const t = i / 50;
  const rsa = 1 + 0.08 * Math.sin(2 * Math.PI * 0.25 * t);
  // 위상 누적 근사
  const phase = 2 * Math.PI * (1.2 * t - (0.08 / (2 * Math.PI * 0.25)) * 1.2 * Math.cos(2 * Math.PI * 0.25 * t));
  void rsa;
  const pulse = Math.max(0, Math.sin(phase)) ** 2;
  const drift = 3000 * Math.sin(2 * Math.PI * 0.02 * t) + 800 * Math.sin(2 * Math.PI * 0.25 * t);
  const noise = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 80;
  return { timestamp: base + i * 20, ir: 120000 + drift + 1500 * pulse + noise, red: 90000 + drift * 0.7 + 1000 * pulse + noise };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_000_000)); (AnalysisMetricsService as unknown as { instance: null }).instance = null; });
afterEach(() => vi.useRealTimers());

describe('호흡·HRV 계산 경로 재현', () => {
  for (const pkt of [10, 25]) {
    it(`패킷 ${pkt}샘플 — 150초 안에 호흡·HRV 가 값을 가진다`, async () => {
      const sp = new StreamProcessor();
      const svc = AnalysisMetricsService.getInstance();
      const log: string[] = [];
      let n = 0;
      for (let s = 0; s < 150 * 50; s += pkt) {
        const samples = Array.from({ length: pkt }, (_, k) => ppgSample(s + k, 1_000_000));
        sp.processPPGData(samples);
        await vi.advanceTimersByTimeAsync(pkt * 20);
        n += pkt;
        if (n % (50 * 15) === 0) log.push(`${n / 50}s rr=${svc.getRRBufferStatus().bufferLength} sdnn=${svc.getCurrentSDNN()} resp=${svc.getCurrentRespiratoryRate()} why=${svc.getRespiratoryNullReason()} hr=${svc.getCurrentHeartRate()}`);
      }
      console.log(log.join('\n'));
      expect(svc.getCurrentSDNN()).not.toBeNull();
      expect(svc.getCurrentRespiratoryRate()).not.toBeNull();
    }, 120000);
  }
});
