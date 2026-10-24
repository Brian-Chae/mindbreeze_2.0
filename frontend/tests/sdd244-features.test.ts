import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFeatureRecord, derivedPayloads, SCALAR_KEYS, type DerivedRef, type FeatureResult } from '../src/lib/biosignal/feature-record';
import type { Signal } from '../src/lib/biosignal/raw-types';

const dir = new URL('../../specs/sdd-244-biosignal-raw-pipeline/contracts/', import.meta.url);
const fixtures: Array<Record<string, unknown> & { signal: Signal }> = JSON.parse(readFileSync(new URL('fixtures/feature-v1.json', dir), 'utf8'));
const inventory: Record<Signal, { fields: string[] }> = JSON.parse(readFileSync(new URL('fixtures/processor-inventory.json', dir), 'utf8'));

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ timestamp: 1000 + i * 4, fp1: i, fp2: -i }));
const eeg = (over: Record<string, unknown> = {}): FeatureResult => ({ signal: 'eeg', data: {
  filteredData: pts(3), signalQuality: { overall: 95, fp1: 94, fp2: 96, sqi: [1, 1, 1] },
  bandPowers: { delta: 1, theta: 2, alpha: 3, beta: 4, gamma: 5 },
  brainState: { currentState: 'relaxed', confidence: 0.5, stateHistory: ['relaxed'], recommendations: ['x'], metrics: { arousal: 0.1, valence: 0.2, attention: 0.3, relaxation: 0.4 } },
  frequencySpectrum: { frequencies: [1, 2], ch1Power: [0.5, 0.25], ch2Power: [0.25, 0.5], timestamp: 1000 },
  indices: { focusIndex: 1, relaxationIndex: 2, stressIndex: 3, hemisphericBalance: 0.1, cognitiveLoad: 4, emotionalStability: 5, totalPower: 6, totalNeuralActivity: 7, faa: -0.2 },
  rawAnalysis: { ch1SQI: [1, 1, 1], ch2SQI: [1, 1, 1], overallSQI: [1, 1, 1] }, ...over } });
const ppg = (over: Record<string, unknown> = {}): FeatureResult => ({ signal: 'ppg', data: {
  filteredData: [{ timestamp: 1, red: 1, ir: 2 }, { timestamp: 2, red: 3, ir: 4 }, { timestamp: 3, red: 5, ir: 6 }],
  signalQuality: { overall: 90, red: 89, ir: 91, sqi: [1, 1, 1], redSQI: [1, 1, 1], irSQI: [1, 1, 1], overallSQI: [1, 1, 1] },
  vitals: { heartRate: 60, hrv: 12 }, peakInfo: { peakCount: 3, avgPeakInterval: 1000, peakQuality: 0.9 },
  advancedHRV: { sdnn: 1, pnn50: 1, lfPower: 1, hfPower: 1, lfHfRatio: 1, stressIndex: 1, avnn: 1, pnn20: 1, sdsd: 1, hrMax: 1, hrMin: 1 },
  rrIntervals: [980, 1000, 1020], ...over } });
const acc = (): FeatureResult => ({ signal: 'acc', data: {
  filteredData: [{ timestamp: 1, x: 0, y: 0, z: 1 }, { timestamp: 2, x: 0, y: 0, z: 1 }, { timestamp: 3, x: 0, y: 0, z: 1 }],
  magnitude: [{ timestamp: 1, value: 1 }, { timestamp: 2, value: 1 }, { timestamp: 3, value: 1 }],
  activity: { type: 'stationary', confidence: 1, intensity: 0 }, movement: { avgMovement: 0, stdMovement: 0, maxMovement: 0, totalMovement: 0 },
  posture: { tiltAngle: 0, stability: 1, balance: 1 }, signalQuality: { overall: 1, reliability: 1, consistency: 1 } } });

const ref = (path: string, count: number): DerivedRef => ({ artifact_id_alias: 'DERIVED-X', sha256: 'a'.repeat(64), field_path: path, first_sample_index: 0, sample_count: count, availability: 'available', unavailable_reason: null });
const algorithm = { algorithm_id: 'mb-web', algorithm_version: '1', parameters_hash: 'b'.repeat(64), parameters: { x: 1 }, filter_version: '1', build: 'web' };
const window = (signal: Signal) => [{ signal, stream_alias: 'STREAM1', segment_alias: 'SEG1', raw_artifact_id_alias: 'RAW-X', raw_sha256: 'c'.repeat(64), first_sample_index: 0, end_sample_index_exclusive: 3, time_range: { from_us: '0', to_us: '8000' }, valid_sample_count: 3 }];
const build = (result: FeatureResult, extras = {}, sequence = 0) => buildFeatureRecord({ result, sequence, featureAlias: `FEAT-${result.signal.toUpperCase()}-${sequence}`, playGroupId: null, windowIndex: 0, tRelMs: 0, computedAtUs: '1000000', measuredAtUs: '0', algorithm, sourceWindows: window(result.signal), firstSample: 0, extras, ref });

/** 파이썬 FeatureRecord.complete_output의 의미 검증을 독립적으로 옮긴 것: null 숫자 경로마다 사유가 있어야 한다. */
function nullPaths(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) value.forEach((v, i) => { if (v === null) out.push(`${path}.${i}`); else nullPaths(v, `${path}.${i}`, out); });
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    if (v === null) out.push(`${path}.${k}`); else nullPaths(v, `${path}.${k}`, out);
  }
}
const keysOf = (v: unknown, path = ''): string[] => Array.isArray(v) ? (v.length ? keysOf(v[0], `${path}[]`) : []) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [`${path}.${k}`, ...keysOf(x, `${path}.${k}`)]) : [];

describe('SDD244 T09 FeatureRecord', () => {
  for (const [signal, make] of [['eeg', eeg], ['ppg', ppg], ['acc', acc]] as const) {
    it(`${signal}: 고정 fixture와 같은 key 구조다`, () => {
      const { record } = build(make());
      const fixture = fixtures.find(f => f.signal === signal)!;
      const strip = (k: string) => k.replace(/^\.(source_windows|algorithm|scalar_null_reasons|detail_null_reasons)\..*/, '.$1').replace(/^(\.eeg\.brainState\.metrics)\..*/, '$1');
      expect([...new Set(keysOf(record).map(strip))].sort()).toEqual([...new Set(keysOf(fixture).map(strip))].sort());
      // JSON Schema(2020-12) 검증기는 FE에 없다. 구조는 위 key 동치로, 의미는 아래 null 사유 테스트로 검사한다.
      expect(record.schema_version).toBe('feature-v1');
    });
    it(`${signal}: 처리기 반환 inventory 필드가 하나도 빠지지 않는다`, () => {
      const { record } = build(make());
      const present = new Set(keysOf((record as unknown as Record<string, unknown>)[signal]).map(k => k.split('.').pop()!));
      for (const field of inventory[signal].fields) {
        // 처리기 반환 타입 그 자체 필드(EEG ch1Power 등 스펙트럼 하위 포함)가 레코드 어딘가에 있어야 한다.
        expect(present.has(field), `${signal}.${field} 미반영`).toBe(true);
      }
    });
  }

  it('null 스칼라와 null 상세 숫자마다 사유가 정확히 대응한다', () => {
    const { record } = build(ppg(), { rmssd: 30 });
    const nullScalars = SCALAR_KEYS.filter(k => (record.scalars as Record<string, unknown>)[k] === null).sort();
    expect(Object.keys(record.scalar_null_reasons).sort()).toEqual(nullScalars);
    const paths: string[] = []; nullPaths(record.ppg, 'ppg', paths);
    const numericNulls = paths.filter(p => !p.endsWith('.beats') && !p.endsWith('.beats_reason') && !p.includes('unavailable_reason') && !p.endsWith('recommendations') && !p.endsWith('.metrics'));
    expect(Object.keys(record.detail_null_reasons).sort()).toEqual(numericNulls.sort());
    expect(record.detail_null_reasons['ppg.vitals.spo2']).toBe('not_emitted_by_current_processor');
    expect(record.ppg).toMatchObject({ beats: null, beats_reason: 'not_emitted_by_current_processor' });
  });

  it('NaN/Infinity는 null+non_finite 사유로 남기고 0으로 바꾸지 않는다', () => {
    const { record } = build(eeg({ indices: { focusIndex: Number.NaN, relaxationIndex: 2, stressIndex: 3, hemisphericBalance: 0, cognitiveLoad: 4, emotionalStability: 5, totalPower: Infinity, totalNeuralActivity: 7, faa: null } }));
    expect(record.scalars.focus_index).toBeNull(); expect(record.scalar_null_reasons.focus_index).toBe('non_finite');
    expect(record.scalars.total_power).toBeNull();
    expect(record.scalars.faa).toBeNull(); expect(record.detail_null_reasons['eeg.indices.faa']).toBe('not_computed');
    expect(JSON.stringify(record)).not.toMatch(/NaN|Infinity/);
  });

  it('누락됐던 스칼라 total_neural_activity·faa를 EEG 처리기 indices에서 연결한다', () => {
    const { record } = build(eeg());
    expect(record.scalars).toMatchObject({ total_neural_activity: 7, faa: -0.2, meditation_level: 2, attention_level: 1, total_power: 6 });
    expect(record.play_group_id).toBeNull();
    expect(build(eeg(), {}, 1).record.play_group_id).toBeNull();
  });

  it('파형·SQI 배열은 레코드에 복제되지 않고 raw-derived 참조와 별도 payload로만 존재한다', () => {
    const result = eeg();
    const { record } = build(result);
    expect(JSON.stringify(record)).not.toContain('"timestamp":1000,"fp1"');
    expect(record.eeg).toMatchObject({ filteredData: { field_path: 'filteredData', sample_count: 3 }, rawAnalysis: { ch1SQI: { field_path: 'ch1SQI' } }, channelBandPowers: null, channelBandPowers_reason: 'not_emitted_by_current_processor' });
    expect(Object.keys(derivedPayloads(result)).sort()).toEqual(['ch1SQI', 'ch2SQI', 'filteredData', 'overallSQI', 'sqi']);
    expect(Object.keys(derivedPayloads(acc())).sort()).toEqual(['filteredData', 'magnitude']);
  });

  it('PPG 중첩 창 4회 emit은 4개의 서로 다른 feature id/sequence를 가진다(덮어쓰기 0)', () => {
    const records = [0, 1, 2, 3].map(i => build(ppg(), {}, i).record);
    expect(new Set(records.map(r => r.feature_id_alias)).size).toBe(4);
    expect(records.map(r => r.sequence)).toEqual([0, 1, 2, 3]);
  });
});
