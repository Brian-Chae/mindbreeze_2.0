/**
 * SDD-246 T01 — 골든 oracle runner.
 *
 * 기존 승인 TS 처리(frontend/src/lib/eeg/)를 **수정 없이** 가져와 결정적 가상 시계로 구동한다.
 *   parse(blePacketParser) → TimestampSynchronizer → StreamProcessor(EEG Morlet/PSD, PPG 피크/RR)
 *   → AnalysisMetricsService(SDNN/호흡) → eegPersonalScore(표시값)
 * 이 파일은 expected 를 '만드는' 쪽이며 Rust/T02 코어를 쓰지 않는다. T02/T11 은 이 expected 에 맞춰야 한다.
 *
 * 결정성: Date/performance/setInterval 을 vi fake timer 로 고정(BASE_MS + 도착 µs). Math.random 미사용 확인됨.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';

import { parseACCPacket, parseEEGPacket, parsePPGPacket } from '../../../../frontend/src/lib/eeg/blePacketParser';
import { TimestampSynchronizer } from '../../../../frontend/src/lib/eeg/TimestampSynchronizer';
import { StreamProcessor } from '../../../../frontend/src/lib/eeg/StreamProcessor';
import { AnalysisMetricsService } from '../../../../frontend/src/lib/eeg/AnalysisMetricsService';
import { scoreIndices } from '../../../../frontend/src/lib/eeg/eegPersonalScore';

export const V1_DIR = join(__dirname, '..');
export const BASE_MS = 1_760_000_000_000;
export const FILTER_MODE = (process.env.ORACLE_FILTER || 'biquad') as 'biquad' | 'legacy_fallback';
/** biquad 모드 expected 는 expected/oracle, fallback 은 expected/legacy_fallback. */
export const ORACLE_DIR = FILTER_MODE === 'biquad' ? 'oracle' : 'legacy_fallback';

export function canon(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return 'NaN';
      if (v === Infinity) return 'Infinity';
      if (v === -Infinity) return '-Infinity';
      if (Object.is(v, -0)) return '-0';
    }
    return v;
  });
}
export const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
export const hashOf = (v: unknown) => sha256(canon(v));

export interface StageBundle {
  meta: Record<string, unknown>;
  decoded: unknown[];
  clock: unknown[];
  eeg_psd_bandpower: unknown[];
  eeg_raw_indices: unknown[];
  ppg_peaks_rr: unknown[];
  hrv_sdnn_respiration: unknown[];
  display: unknown[];
  acc: unknown[];
}

/** 고정 sigmoid 모델 — 합성 값(실측 모델 아님). active_sigmoid 경로 시험용. */
export function pinnedModel() {
  const params: Record<string, { m: number; s: number; direction: 1 | -1 }> = {
    focusIndex: { m: 0.3, s: 0.8, direction: 1 },
    relaxationIndex: { m: -1.4, s: 0.5, direction: 1 },
    stressIndex: { m: 0.2, s: 0.9, direction: -1 },
    totalNeuralActivity: { m: 5.0, s: 2.0, direction: 1 },
    faa: { m: 0, s: 0.6, direction: -1 },
    cognitiveLoad: { m: 1.1, s: 0.4, direction: -1 },
    emotionalStability: { m: 0.5, s: 0.9, direction: 1 },
  };
  return { id: 'synthetic-pinned', version: 'synthetic-1', n_samples: 0, params, created_at: '2026-10-26T00:00:00Z', is_active: true } as never;
}

const r6 = (x: number) => x; // 반올림하지 않는다 — 전체 정밀도 보존

export async function runOracle(streamDir = join(V1_DIR, 'synth')): Promise<StageBundle> {
  const blob = readFileSync(join(streamDir, 'stream.bin'));
  const sched: [number, 'eeg' | 'ppg' | 'acc', number, number][] = JSON.parse(readFileSync(join(streamDir, 'schedule.json'), 'utf8'));

  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(BASE_MS);
  AnalysisMetricsService.resetInstance();
  const svc = AnalysisMetricsService.getInstance();
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const fallbackWarns: string[] = [];
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { const m = String(a[0]); if (/기본 구현 사용|fallback 사용/.test(m)) fallbackWarns.push(m); });

  const rrCalls: { t: number; rr: number[]; ts: number[] }[] = [];
  const origPpg = svc.processPPGAnalysisMetrics.bind(svc);
  vi.spyOn(svc, 'processPPGAnalysisMetrics').mockImplementation(async (...args: Parameters<typeof origPpg>) => {
    rrCalls.push({ t: Date.now(), rr: [...(args[4] ?? [])], ts: [...(args[5] ?? [])] });
    return origPpg(...args);
  });

  const out: StageBundle = {
    meta: {}, decoded: [], clock: [], eeg_psd_bandpower: [], eeg_raw_indices: [], ppg_peaks_rr: [], hrv_sdnn_respiration: [], display: [], acc: [],
  };
  const sync = new TimestampSynchronizer();
  const counter = { samples: 0 };
  let lastAcc = 0;
  let accCount = 0;
  const sp = new StreamProcessor();
  let eegN = 0;
  let ppgN = 0;
  const model = pinnedModel();

  sp.setCallbacks({
    onProcessedEEG: (d: any) => {
      eegN += 1;
      const now = Date.now();
      out.eeg_psd_bandpower.push({
        i: eegN, t_ms: now - BASE_MS, bandPowers: d.bandPowers, signalQuality: d.signalQuality,
        spectrum: { frequencies: d.frequencySpectrum.frequencies, ch1Power: d.frequencySpectrum.ch1Power, ch2Power: d.frequencySpectrum.ch2Power },
        filtered: { n: d.filteredData.length, hash: hashOf(d.filteredData.map((p: any) => [p.timestamp, p.fp1, p.fp2])) },
      });
      const idx = d.indices;
      out.eeg_raw_indices.push({ i: eegN, t_ms: now - BASE_MS, ...idx });
      const input = {
        focusIndex: idx.focusIndex, relaxationIndex: idx.relaxationIndex, stressIndex: idx.stressIndex,
        totalNeuralActivity: idx.totalPower, cognitiveLoad: idx.cognitiveLoad, emotionalStability: idx.emotionalStability,
        hemisphericBalance: idx.hemisphericBalance, faa: idx.faa,
      };
      out.display.push({
        i: eegN, t_ms: now - BASE_MS, input,
        legacy_cohort: scoreIndices(input, null),
        active_sigmoid: scoreIndices(input, model),
      });
    },
    onProcessedPPG: (d: any) => {
      ppgN += 1;
      const call = rrCalls[rrCalls.length - 1];
      out.ppg_peaks_rr.push({
        i: ppgN, t_ms: Date.now() - BASE_MS, vitals: d.vitals, sqi_overall: d.signalQuality?.overall ?? null, peakInfo: d.peakInfo,
        rr: call && call.t === Date.now() ? call.rr : [], rr_end_ts_rel_ms: call && call.t === Date.now() ? call.ts.map((x) => x - BASE_MS) : [],
      });
      out.hrv_sdnn_respiration.push({ i: ppgN, t_ms: Date.now() - BASE_MS, hrv: svc.getCurrentHRVMetrics(), respiratory_null_reason: svc.getRespiratoryNullReason(), rr_buffer: svc.getRRBufferStatus() });
    },
    // 이전 버전은 d.activity/d.movement 를 읽어 전부 null 이었다 — 실제 페이로드 키는 indices/magnitude(rawBufferData 는 제외).
    onProcessedACC: (d: any) => {
      out.acc.push({ t_ms: Date.now() - BASE_MS, indices: d.indices, magnitude_n: d.magnitude?.length ?? 0, magnitude_last: d.magnitude?.length ? d.magnitude[d.magnitude.length - 1].value : null, motion: svc.getCurrentMotion() });
    },
  } as never);

  let prevMs = 0;
  let k = 0;
  for (const [arrUs, sensor, off, len] of sched) {
    const ms = Math.floor(arrUs / 1000);
    if (ms > prevMs) { await vi.advanceTimersByTimeAsync(ms - prevMs); prevMs = ms; }
    const bytes = blob.subarray(off, off + len);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let samples: any[] = [];
    let kind = sensor;
    if (sensor === 'eeg') samples = parseEEGPacket(dv, sync, counter as never).samples;
    else if (sensor === 'ppg') samples = parsePPGPacket(dv, sync, counter as never).samples;
    else {
      const r = parseACCPacket(dv, sync, counter as never, lastAcc, accCount);
      samples = r.samples; lastAcc = r.newLastTimestamp; accCount = r.newPacketCount;
    }
    // decoded + clock 단계
    out.decoded.push({ k, sensor: kind, arrival_us: arrUs, n: samples.length, vals: hashOf(samples.map((s) => (sensor === 'eeg' ? [s.ch1, s.ch2, s.leadoff_ch1, s.leadoff_ch2] : sensor === 'ppg' ? [s.red, s.ir] : [s.x, s.y, s.z]))) });
    out.clock.push({ k, sensor: kind, n: samples.length, first_ts_rel_ms: samples.length ? samples[0].timestamp - BASE_MS : null, last_ts_rel_ms: samples.length ? samples[samples.length - 1].timestamp - BASE_MS : null, ts_hash: hashOf(samples.map((s) => s.timestamp)) });
    if (samples.length) {
      if (sensor === 'eeg') sp.processEEGData(samples);
      else if (sensor === 'ppg') sp.processPPGData(samples);
      else sp.processACCData(samples);
      await vi.advanceTimersByTimeAsync(0);
    }
    k += 1;
  }
  await vi.advanceTimersByTimeAsync(2000);
  sp.dispose();
  logSpy.mockRestore(); warnSpy.mockRestore();
  vi.useRealTimers();
  vi.restoreAllMocks();
  AnalysisMetricsService.resetInstance();
  out.meta = { filter_mode: FILTER_MODE, fallback_warnings: fallbackWarns.length, packets: sched.length, eeg_emissions: eegN, ppg_emissions: ppgN, base_ms: BASE_MS };
  void r6;
  return out;
}

/** 단계별 요약(expected 본문): 개수 + 전체 해시 + 핵심 지점 값. 전체 상세는 별도 파일. */
export function summarize(b: StageBundle) {
  const stages: Record<string, { count: number; sha256: string }> = {};
  for (const key of Object.keys(b) as (keyof StageBundle)[]) {
    if (key === 'meta') continue;
    const arr = b[key] as unknown[];
    stages[key] = { count: arr.length, sha256: hashOf(arr) };
  }
  return stages;
}
