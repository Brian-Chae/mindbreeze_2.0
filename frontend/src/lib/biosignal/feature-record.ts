/**
 * SDD-244 T09 — 처리기 emit 1회 → feature-v1 FeatureRecord 변환(순수 함수).
 * 모든 숫자 필드는 유한값이거나 null+사유다(NaN/Inf·0 치환 금지). 파형/SQI 배열은 레코드에 복제하지 않고
 * raw-derived 객체 참조(DerivedReference)로만 남긴다. 현재 처리기가 내놓지 않는 필드는 not_emitted 사유로 남긴다.
 */
import type { Signal } from './raw-types';
import { toApiSignalQuality } from '../session-live/signal-status';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = Record<string, unknown>;

export const SCALAR_KEYS = [
  'focus_index', 'cognitive_load', 'relaxation_index', 'stress_index', 'emotional_stability', 'total_neural_activity', 'faa', 'hemispheric_balance',
  'delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power', 'total_power', 'meditation_level', 'attention_level', 'signal_quality',
  'sdnn', 'rmssd', 'lf_power', 'hf_power', 'lf_hf_ratio', 'heart_rate', 'respiratory_rate', 'motion', 'quality', 'device_timestamp_ms',
] as const;
export type ScalarKey = typeof SCALAR_KEYS[number];
export type Scalars = Record<ScalarKey, number | string | null>;
export type QualityLabel = 'valid' | 'degraded' | 'invalid';

export interface FeatureResult { signal: Signal; data: Obj }
export interface DerivedRef {
  artifact_id_alias: string; sha256: string; field_path: string; first_sample_index: number; sample_count: number;
  availability: 'available' | 'expired' | 'withdrawn' | 'unknown'; unavailable_reason: string | null;
}
export interface AlgorithmSnapshot {
  algorithm_id: string; algorithm_version: string; parameters_hash: string;
  parameters: Record<string, number | string | boolean | number[]>; filter_version: string; build: string;
}
export interface SourceWindow {
  signal: Signal; stream_alias: string; segment_alias: string; raw_artifact_id_alias: string; raw_sha256: string;
  first_sample_index: number; end_sample_index_exclusive: number; time_range: { from_us: string; to_us: string }; valid_sample_count: number;
}
export interface FeatureRecord {
  schema_version: 'feature-v1'; feature_id_alias: string; sequence: number; signal: Signal; play_group_id: string | null;
  window_index: number; t_rel_ms: number; computed_at_us: string; measured_at_us: string; algorithm: AlgorithmSnapshot;
  source_windows: SourceWindow[]; scalars: Scalars; scalar_null_reasons: Record<string, string>; detail_null_reasons: Record<string, string>;
  eeg: Json | null; ppg: Json | null; acc: Json | null; quality: string;
}
export interface BuildInput {
  result: FeatureResult; sequence: number; featureAlias: string; playGroupId: string | null; windowIndex: number; tRelMs: number;
  computedAtUs: string; measuredAtUs: string; algorithm: AlgorithmSnapshot; sourceWindows: SourceWindow[]; firstSample: number;
  /** AnalysisMetricsService 등 처리기 밖에서 오는 보조 스칼라(rmssd·호흡·motion). */
  extras?: Partial<Scalars>;
  ref: (fieldPath: string, sampleCount: number) => DerivedRef;
}

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const NOT_EMITTED = 'not_emitted_by_current_processor';

/** 유한 숫자만 통과. 아니면 null과 사유(경로 기준)를 detail_null_reasons에 남긴다. */
class Reasons {
  readonly detail: Record<string, string> = {};
  num(path: string, value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    this.detail[path] = value === undefined ? NOT_EMITTED : typeof value === 'number' ? 'non_finite' : 'not_computed';
    return null;
  }
  int(path: string, value: unknown): number | null {
    const n = this.num(path, value);
    return n !== null && Number.isInteger(n) && n >= 0 ? n : n === null ? null : (this.detail[path] = 'invalid_count', null);
  }
  list(path: string, value: unknown): (number | null)[] { return arr(value).map((v, i) => this.num(`${path}.${i}`, v)); }
}

/** raw-derived로 분리할 배열(필드 경로 → 값). 레코드에는 참조만 남는다. */
export function derivedPayloads(result: FeatureResult): Record<string, Json> {
  const d = result.data;
  const toJson = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? [], (_k, x: unknown) => (typeof x === 'number' && !Number.isFinite(x) ? null : x))) as Json;
  if (result.signal === 'eeg') {
    const q = obj(d.signalQuality), r = obj(d.rawAnalysis);
    return { filteredData: toJson(d.filteredData), sqi: toJson(q.sqi), ch1SQI: toJson(r.ch1SQI), ch2SQI: toJson(r.ch2SQI), overallSQI: toJson(r.overallSQI) };
  }
  if (result.signal === 'ppg') {
    const q = obj(d.signalQuality);
    return { filteredData: toJson(d.filteredData), sqi: toJson(q.sqi), redSQI: toJson(q.redSQI), irSQI: toJson(q.irSQI), overallSQI: toJson(q.overallSQI) };
  }
  return { filteredData: toJson(d.filteredData), magnitude: toJson(d.magnitude) };
}

/** 0~100(EEG/PPG)·0~1(ACC) 품질 → 라벨. 임계값은 StreamProcessor의 기존 등급(fair≥60)을 따른다. */
export function qualityLabel(overall: number | null, scale: 100 | 1): QualityLabel | null {
  if (overall === null) return null;
  const pct = scale === 1 ? overall * 100 : overall;
  return pct >= 60 ? 'valid' : pct > 0 ? 'degraded' : 'invalid';
}

function buildEeg(d: Obj, r: Reasons, ref: BuildInput['ref'], firstSample: number): { out: Json; scalars: Partial<Scalars>; overall: number | null; tsMs: number | null } {
  const q = obj(d.signalQuality), bp = obj(d.bandPowers), bs = obj(d.brainState), fs = obj(d.frequencySpectrum), ix = obj(d.indices);
  const metrics = d.brainState && bs.metrics ? obj(bs.metrics) : null;
  const overall = r.num('eeg.signalQuality.overall', q.overall);
  const bands = (path: string, b: Obj): Json => ({ delta: r.num(`${path}.delta`, b.delta), theta: r.num(`${path}.theta`, b.theta), alpha: r.num(`${path}.alpha`, b.alpha), beta: r.num(`${path}.beta`, b.beta), gamma: r.num(`${path}.gamma`, b.gamma) });
  const filtered = arr(d.filteredData);
  const refOf = (path: string, values: unknown): Json => ref(path, arr(values).length) as unknown as Json;
  const out: Json = {
    filteredData: ref('filteredData', filtered.length) as unknown as Json,
    signalQuality: { overall, fp1: r.num('eeg.signalQuality.fp1', q.fp1), fp2: r.num('eeg.signalQuality.fp2', q.fp2), sqi: refOf('sqi', q.sqi) },
    bandPowers: bands('eeg.bandPowers', bp),
    brainState: { currentState: String(bs.currentState ?? 'unknown'), confidence: r.num('eeg.brainState.confidence', bs.confidence), stateHistory: arr(bs.stateHistory).map(String),
      recommendations: Array.isArray(bs.recommendations) ? bs.recommendations.map(String) : null,
      metrics: metrics ? { arousal: r.num('eeg.brainState.metrics.arousal', metrics.arousal), valence: r.num('eeg.brainState.metrics.valence', metrics.valence), attention: r.num('eeg.brainState.metrics.attention', metrics.attention), relaxation: r.num('eeg.brainState.metrics.relaxation', metrics.relaxation) } : null },
    frequencySpectrum: { frequencies: r.list('eeg.frequencySpectrum.frequencies', fs.frequencies), ch1Power: r.list('eeg.frequencySpectrum.ch1Power', fs.ch1Power), ch2Power: r.list('eeg.frequencySpectrum.ch2Power', fs.ch2Power), timestamp: r.num('eeg.frequencySpectrum.timestamp', fs.timestamp) },
    indices: { focusIndex: r.num('eeg.indices.focusIndex', ix.focusIndex), relaxationIndex: r.num('eeg.indices.relaxationIndex', ix.relaxationIndex), stressIndex: r.num('eeg.indices.stressIndex', ix.stressIndex),
      hemisphericBalance: r.num('eeg.indices.hemisphericBalance', ix.hemisphericBalance), cognitiveLoad: r.num('eeg.indices.cognitiveLoad', ix.cognitiveLoad), emotionalStability: r.num('eeg.indices.emotionalStability', ix.emotionalStability),
      totalPower: r.num('eeg.indices.totalPower', ix.totalPower), totalNeuralActivity: r.num('eeg.indices.totalNeuralActivity', ix.totalNeuralActivity), faa: r.num('eeg.indices.faa', ix.faa) },
    rawAnalysis: { ch1SQI: refOf('ch1SQI', obj(d.rawAnalysis).ch1SQI), ch2SQI: refOf('ch2SQI', obj(d.rawAnalysis).ch2SQI), overallSQI: refOf('overallSQI', obj(d.rawAnalysis).overallSQI) },
    // 현재 처리기는 채널별 band power를 내놓지 않는다 — 만들어 채우지 않고 사유만 남긴다.
    channelBandPowers: null, channelBandPowers_reason: NOT_EMITTED,
    // 측정 가드 결과(무효 창은 지표가 null). 처리기가 내지 않은 과거 입력은 valid/null 로 본다.
    validity: d.validity === 'invalid' ? 'invalid' : 'valid',
    reason: typeof d.reason === 'string' ? d.reason : null,
  };
  void firstSample;
  const idx = out as { indices: Record<string, number | null>; bandPowers: Record<string, number | null> };
  const last = filtered.length ? obj(filtered[filtered.length - 1]).timestamp : undefined;
  return { out, overall, tsMs: typeof last === 'number' && Number.isFinite(last) ? last : null, scalars: {
    focus_index: idx.indices.focusIndex, cognitive_load: idx.indices.cognitiveLoad, relaxation_index: idx.indices.relaxationIndex, stress_index: idx.indices.stressIndex,
    emotional_stability: idx.indices.emotionalStability, total_neural_activity: idx.indices.totalNeuralActivity, faa: idx.indices.faa, hemispheric_balance: idx.indices.hemisphericBalance,
    delta_power: idx.bandPowers.delta, theta_power: idx.bandPowers.theta, alpha_power: idx.bandPowers.alpha, beta_power: idx.bandPowers.beta, gamma_power: idx.bandPowers.gamma,
    total_power: idx.indices.totalPower,
    // 기존 DB feature 관례(useBand.metricsToFeature): 명상=이완지수, 주의=집중지수
    meditation_level: idx.indices.relaxationIndex, attention_level: idx.indices.focusIndex,
    signal_quality: overall === null ? null : toApiSignalQuality(overall),
  } };
}

function buildPpg(d: Obj, r: Reasons, ref: BuildInput['ref']): { out: Json; scalars: Partial<Scalars>; overall: number | null; tsMs: number | null } {
  const q = obj(d.signalQuality), v = obj(d.vitals), pk = obj(d.peakInfo), h = obj(d.advancedHRV);
  const overall = r.num('ppg.signalQuality.overall', q.overall);
  const filtered = arr(d.filteredData);
  const refOf = (path: string, values: unknown): Json => ref(path, arr(values).length) as unknown as Json;
  const hrv = { sdnn: r.num('ppg.advancedHRV.sdnn', h.sdnn), pnn50: r.num('ppg.advancedHRV.pnn50', h.pnn50), lfPower: r.num('ppg.advancedHRV.lfPower', h.lfPower), hfPower: r.num('ppg.advancedHRV.hfPower', h.hfPower),
    lfHfRatio: r.num('ppg.advancedHRV.lfHfRatio', h.lfHfRatio), stressIndex: r.num('ppg.advancedHRV.stressIndex', h.stressIndex), avnn: r.num('ppg.advancedHRV.avnn', h.avnn), pnn20: r.num('ppg.advancedHRV.pnn20', h.pnn20),
    sdsd: r.num('ppg.advancedHRV.sdsd', h.sdsd), hrMax: r.num('ppg.advancedHRV.hrMax', h.hrMax), hrMin: r.num('ppg.advancedHRV.hrMin', h.hrMin) };
  const vitals = { heartRate: r.num('ppg.vitals.heartRate', v.heartRate), hrv: r.num('ppg.vitals.hrv', v.hrv), spo2: r.num('ppg.vitals.spo2', v.spo2) };
  const out: Json = {
    filteredData: ref('filteredData', filtered.length) as unknown as Json,
    signalQuality: { overall, red: r.num('ppg.signalQuality.red', q.red), ir: r.num('ppg.signalQuality.ir', q.ir), sqi: refOf('sqi', q.sqi), redSQI: refOf('redSQI', q.redSQI), irSQI: refOf('irSQI', q.irSQI), overallSQI: refOf('overallSQI', q.overallSQI) },
    vitals, peakInfo: { peakCount: r.int('ppg.peakInfo.peakCount', pk.peakCount), avgPeakInterval: r.num('ppg.peakInfo.avgPeakInterval', pk.avgPeakInterval), peakQuality: r.num('ppg.peakInfo.peakQuality', pk.peakQuality) },
    advancedHRV: hrv, rrIntervals: r.list('ppg.rrIntervals', d.rrIntervals),
    // beat ID는 현재 처리기 출력에 없다 — 위조하지 않는다.
    beats: null, beats_reason: NOT_EMITTED,
  };
  const last = filtered.length ? obj(filtered[filtered.length - 1]).timestamp : undefined;
  return { out, overall, tsMs: typeof last === 'number' && Number.isFinite(last) ? last : null, scalars: {
    sdnn: hrv.sdnn, lf_power: hrv.lfPower, hf_power: hrv.hfPower, lf_hf_ratio: hrv.lfHfRatio, heart_rate: vitals.heartRate,
    signal_quality: overall === null ? null : toApiSignalQuality(overall),
  } };
}

const ACTIVITY = ['stationary', 'sitting', 'walking', 'running'];
function buildAcc(d: Obj, r: Reasons, ref: BuildInput['ref']): { out: Json; scalars: Partial<Scalars>; overall: number | null; tsMs: number | null } {
  const a = obj(d.activity), m = obj(d.movement), p = obj(d.posture), q = obj(d.signalQuality);
  const filtered = arr(d.filteredData), mag = arr(d.magnitude);
  const overall = r.num('acc.signalQuality.overall', q.overall);
  const out: Json = {
    filteredData: ref('filteredData', filtered.length) as unknown as Json, magnitude: ref('magnitude', mag.length) as unknown as Json,
    activity: { type: ACTIVITY.includes(String(a.type)) ? String(a.type) : 'stationary', confidence: r.num('acc.activity.confidence', a.confidence), intensity: r.num('acc.activity.intensity', a.intensity) },
    movement: { avgMovement: r.num('acc.movement.avgMovement', m.avgMovement), stdMovement: r.num('acc.movement.stdMovement', m.stdMovement), maxMovement: r.num('acc.movement.maxMovement', m.maxMovement), totalMovement: r.num('acc.movement.totalMovement', m.totalMovement) },
    posture: { tiltAngle: r.num('acc.posture.tiltAngle', p.tiltAngle), stability: r.num('acc.posture.stability', p.stability), balance: r.num('acc.posture.balance', p.balance) },
    signalQuality: { overall, reliability: r.num('acc.signalQuality.reliability', q.reliability), consistency: r.num('acc.signalQuality.consistency', q.consistency) },
  };
  const last = filtered.length ? obj(filtered[filtered.length - 1]).timestamp : undefined;
  return { out, overall, tsMs: typeof last === 'number' && Number.isFinite(last) ? last : null, scalars: { signal_quality: overall === null ? null : Math.min(1, Math.max(0, overall > 1 ? overall / 100 : overall)) } };
}

export function buildFeatureRecord(input: BuildInput): { record: FeatureRecord } {
  const { result } = input;
  const reasons = new Reasons();
  const built = result.signal === 'eeg' ? buildEeg(result.data, reasons, input.ref, input.firstSample)
    : result.signal === 'ppg' ? buildPpg(result.data, reasons, input.ref) : buildAcc(result.data, reasons, input.ref);
  const scalars = Object.fromEntries(SCALAR_KEYS.map(k => [k, null])) as Scalars;
  const nullReason: Record<string, string> = {};
  const scale = result.signal === 'acc' ? 1 : 100;
  const label = qualityLabel(result.signal === 'acc' ? (built.overall === null ? null : built.overall > 1 ? built.overall / 100 : built.overall) : built.overall, scale === 1 ? 1 : 100);
  const merged: Partial<Scalars> = { ...built.scalars, ...(input.extras ?? {}), quality: label, device_timestamp_ms: built.tsMs };
  for (const key of SCALAR_KEYS) {
    const value = merged[key];
    const own = key in built.scalars;
    if (typeof value === 'number' && Number.isFinite(value)) scalars[key] = value;
    else if (typeof value === 'string') scalars[key] = value;
    else nullReason[key] = typeof value === 'number' ? 'non_finite' : own || (input.extras && key in input.extras) ? 'not_computed' : 'not_collected_by_this_signal';
  }
  // 상세 필드에서 이미 사유가 있는 스칼라(NaN 등)는 더 구체적인 사유를 따른다.
  const detailOf: Record<string, string> = { focus_index: 'indices.focusIndex', total_power: 'indices.totalPower', faa: 'indices.faa' };
  for (const [key, path] of Object.entries(detailOf)) if (nullReason[key] && reasons.detail[`${result.signal}.${path}`] === 'non_finite') nullReason[key] = 'non_finite';
  const record: FeatureRecord = {
    schema_version: 'feature-v1', feature_id_alias: input.featureAlias, sequence: input.sequence, signal: result.signal, play_group_id: input.playGroupId,
    window_index: input.windowIndex, t_rel_ms: input.tRelMs, computed_at_us: input.computedAtUs, measured_at_us: input.measuredAtUs, algorithm: input.algorithm,
    source_windows: input.sourceWindows, scalars, scalar_null_reasons: nullReason, detail_null_reasons: reasons.detail,
    eeg: result.signal === 'eeg' ? built.out : null, ppg: result.signal === 'ppg' ? built.out : null, acc: result.signal === 'acc' ? built.out : null,
    quality: label ?? 'unknown',
  };
  return { record };
}
