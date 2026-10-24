/**
 * SDD-244 T11 — 화면에 실제로 보인 6지표를 1초마다 보존하는 DisplaySnapshot(indices-v1).
 * 화면(MemberStage/MemberSheets)과 같은 반올림 규칙(displayedInteger)·같은 snapshot 값을 입력으로 받는다.
 * 재계산하지 않는다: 값이 없으면 null+사유, 렌더되지 않은 초는 not_rendered(값 생성 금지). 종합점수 없음.
 */
import type { ArtifactMeta } from '../api/biosignal';
import type { NormalizationModelDto } from '../api/normalization-api';
import { parseModelParams } from '../eeg/eegPersonalScore';
import { SIGMOID_C, type CalibrationMetricKey } from '../eeg/eegSigmoidScore';
import { EMOTIONAL_STABILITY_PERCENTILES, FOCUS_PERCENTILES, RELAXATION_TRAPEZOID } from '../eeg/eegScoreConstants';
import type { PlayerMetricKey } from '../class/player-case';
import type { BiosignalQueue } from './durable-queue';
import { sha256, type BiosignalCaptureSession } from './capture-session';
import type { AlgorithmSnapshot } from './feature-record';

export type ViewKind = 'participant_player' | 'session_player';
export type MetricValues = Record<PlayerMetricKey, number | null>;
export interface NormalizationMetric { m: number | null; s: number | null; direction: 1 | -1 | null; source: 'standard_model' | 'cohort' | 'b0'; b0_version: string | null; fallback_reason: string | null }
export interface NormalizationSnapshot {
  model_id_alias: string; version: string; params_hash: string; focus: NormalizationMetric; relaxation: NormalizationMetric; emotional: NormalizationMetric;
  formula_version: string; formula_constants: Record<string, number>; source: 'standard_model' | 'cohort' | 'b0' | 'mixed'; cached: boolean;
}
export interface DisplayMetricRow {
  input_source: 'local_ble' | 'socket' | 'remote_fallback' | 'reconstructed' | 'unavailable'; event_age_ms: number | null; value: number | null;
  display_input: number | null; normalized_output: number | null; measured_at_us: string | null; source_feature_id: string | null; provenance_reason: string | null;
  held: boolean; stale: boolean; lead_off: boolean; quality: string; null_reason: string | null;
  normalization_source: 'standard_model' | 'cohort' | 'b0' | 'physical' | 'unavailable';
}
export interface DisplaySnapshotRow {
  schema_version: 'indices-v1'; stream_alias: string; view_instance_alias: string; view_kind: ViewKind; second_index: number; t_rel_ms: number;
  play_group_id: string | null; window_index: number | null; displayed_at_us: string | null; render_status: 'rendered' | 'not_rendered' | 'unavailable';
  focus: DisplayMetricRow; relaxation: DisplayMetricRow; emotional: DisplayMetricRow; bpm: DisplayMetricRow; respiration: DisplayMetricRow; hrv: DisplayMetricRow;
  hrv_metric: 'sdnn'; normalization: NormalizationSnapshot | null; algorithm: AlgorithmSnapshot | null; display_pipeline_version: string | null;
  source: 'displayed' | 'reconstructed' | 'report_aggregate' | 'unavailable'; display_match: boolean | 'unverified'; unavailable_reason: string | null;
}
/** 이번 렌더에서 뷰가 실제로 받은 값과 그 근거. */
export interface RenderedMetrics {
  values: MetricValues;
  /** 정규화 전 raw 지수(display_input). 원격 fallback이면 null */
  rawMind: { focus: number | null; relaxation: number | null; emotional: number | null };
  live: boolean; remoteRelaxation: boolean; blocked: boolean; leadOff: boolean; stale: boolean;
  lastEegAtMs: number | null; quality: string;
  /** 호흡이 null일 때의 처리기 사유(예: insufficient_window) */
  respirationNullReason: string | null;
}
export interface SnapshotContext {
  streamId: string; viewInstanceId: string; viewKind: ViewKind; nowMs: number; startMs: number;
  normalization: NormalizationSnapshot | null; algorithm: AlgorithmSnapshot | null; displayPipelineVersion: string | null;
  sourceFeature: (signal: 'eeg' | 'ppg') => string | null;
}

export const DISPLAY_PIPELINE_VERSION = 'member-player-1hz-v1';
export const B0_VERSION = 'haru-constants-v2-B0';
const MIND = ['focus', 'relaxation', 'emotional'] as const;
const BODY = ['bpm', 'respiration', 'hrv'] as const;
const short = (id: string) => id.replace(/-/g, '').slice(0, 8);

/** MemberStage·MemberSheets와 같은 표시 규칙(반올림 정수, 비유한값은 미표시). 두 화면이 이 함수를 쓴다. */
export function displayedInteger(raw: number | null | undefined): number | null {
  return raw === null || raw === undefined || !Number.isFinite(raw) ? null : Math.round(raw);
}

const blank = (reason: string, over: Partial<DisplayMetricRow> = {}): DisplayMetricRow => ({
  input_source: 'unavailable', event_age_ms: null, value: null, display_input: null, normalized_output: null, measured_at_us: null, source_feature_id: null,
  provenance_reason: reason, held: false, stale: false, lead_off: false, quality: 'unknown', null_reason: reason, normalization_source: 'unavailable', ...over });

export function buildDisplaySnapshot(input: RenderedMetrics | null, ctx: SnapshotContext, secondIndex: number): DisplaySnapshotRow {
  const head = {
    schema_version: 'indices-v1' as const, stream_alias: `STREAM-${short(ctx.streamId)}`, view_instance_alias: `VIEW-${short(ctx.viewInstanceId)}`, view_kind: ctx.viewKind,
    second_index: secondIndex, t_rel_ms: secondIndex * 1000, play_group_id: null, window_index: secondIndex, hrv_metric: 'sdnn' as const,
  };
  if (!input) {
    const m = blank('not_rendered');
    return { ...head, displayed_at_us: null, render_status: 'not_rendered', focus: m, relaxation: { ...m }, emotional: { ...m }, bpm: { ...m }, respiration: { ...m }, hrv: { ...m },
      normalization: null, algorithm: null, display_pipeline_version: null, source: 'unavailable', display_match: 'unverified', unavailable_reason: 'not_rendered' };
  }
  const eegAge = input.lastEegAtMs === null ? null : Math.max(0, ctx.nowMs - input.lastEegAtMs);
  const eegFeature = ctx.sourceFeature('eeg'), ppgFeature = ctx.sourceFeature('ppg');
  const nullReason = (key: PlayerMetricKey): string => {
    if (input.leadOff) return 'lead_off';
    if (input.stale) return 'link_stale';
    if (input.blocked) return 'blocked';
    if (!input.live && !(key === 'relaxation' && input.remoteRelaxation)) return 'band_not_connected';
    if (key === 'respiration' && input.respirationNullReason) return input.respirationNullReason;
    return 'not_computed';
  };
  const flags = { stale: input.stale, lead_off: input.leadOff, quality: input.quality, held: false };
  const mind = (key: (typeof MIND)[number]): DisplayMetricRow => {
    const raw = input.values[key], value = displayedInteger(raw);
    if (value === null) return { ...blank(nullReason(key), flags), event_age_ms: eegAge };
    const remote = key === 'relaxation' && input.remoteRelaxation;
    const local = input.live && !remote;
    return { input_source: remote ? 'remote_fallback' : local ? 'local_ble' : 'unavailable', event_age_ms: eegAge, value: Math.min(100, Math.max(0, value)),
      display_input: input.rawMind[key], normalized_output: Math.min(100, Math.max(0, raw as number)),
      measured_at_us: input.lastEegAtMs === null ? null : (BigInt(Math.round(input.lastEegAtMs)) * 1000n).toString(),
      source_feature_id: local ? eegFeature : null,
      provenance_reason: local && eegFeature ? null : remote ? 'remote_fallback_server_relaxation' : 'local_feature_not_collected',
      null_reason: null, normalization_source: ctx.normalization?.[key]?.source ?? 'unavailable', ...flags };
  };
  const body = (key: (typeof BODY)[number]): DisplayMetricRow => {
    const raw = input.values[key], value = displayedInteger(raw);
    if (value === null || value < 0) return blank(nullReason(key), flags);
    return { input_source: input.live ? 'local_ble' : 'unavailable', event_age_ms: null, value, display_input: raw as number, normalized_output: null, measured_at_us: null,
      source_feature_id: ppgFeature, provenance_reason: ppgFeature ? null : 'local_feature_not_collected', null_reason: null, normalization_source: 'physical', ...flags };
  };
  return { ...head, displayed_at_us: (BigInt(ctx.nowMs) * 1000n).toString(), render_status: 'rendered', focus: mind('focus'), relaxation: mind('relaxation'), emotional: mind('emotional'),
    bpm: body('bpm'), respiration: body('respiration'), hrv: body('hrv'), normalization: ctx.normalization, algorithm: ctx.algorithm,
    display_pipeline_version: ctx.displayPipelineVersion, source: 'displayed', display_match: true, unavailable_reason: null };
}

// ── 정규화 모델 snapshot (content-addressed) ──
const MODEL_KEYS: Record<(typeof MIND)[number], CalibrationMetricKey> = { focus: 'focusIndex', relaxation: 'relaxationIndex', emotional: 'emotionalStability' };
const B0_CONSTANTS: Record<string, number> = {
  focus_p5: FOCUS_PERCENTILES.p5, focus_p95: FOCUS_PERCENTILES.p95, relaxation_p10: RELAXATION_TRAPEZOID.p10, relaxation_p60: RELAXATION_TRAPEZOID.p60,
  relaxation_p95: RELAXATION_TRAPEZOID.p95, emotional_p5: EMOTIONAL_STABILITY_PERCENTILES.p5, emotional_p95: EMOTIONAL_STABILITY_PERCENTILES.p95,
};

export async function buildNormalizationSnapshot(model: NormalizationModelDto | null): Promise<{ snapshot: NormalizationSnapshot; alias: string }> {
  const metrics = {} as Record<(typeof MIND)[number], NormalizationMetric>;
  for (const key of MIND) {
    const params = model ? parseModelParams(MODEL_KEYS[key], model.params[MODEL_KEYS[key]]) : null;
    metrics[key] = params
      ? { m: params.m, s: params.s, direction: params.direction, source: 'standard_model', b0_version: null, fallback_reason: null }
      : { m: null, s: null, direction: null, source: 'b0', b0_version: B0_VERSION, fallback_reason: model ? 'metric_params_missing' : 'no_active_model' };
  }
  const standard = MIND.filter(k => metrics[k].source === 'standard_model').length;
  const source = standard === 0 ? 'b0' : standard === MIND.length ? 'standard_model' : 'mixed';
  const formulaVersion = standard === 0 ? 'cohort-b0-v2' : 'sigmoid-v1';
  const constants = standard === 0 ? B0_CONSTANTS : { sigmoid_c: SIGMOID_C, ...(standard < MIND.length ? B0_CONSTANTS : {}) };
  const version = model ? String(model.version) : B0_VERSION;
  const hash = await sha256(new TextEncoder().encode(JSON.stringify({ model: model ? String(model.id) : null, version, metrics, formulaVersion, constants })).buffer as ArrayBuffer);
  const alias = `NORM-${hash.slice(0, 12).toUpperCase()}`;
  return { alias, snapshot: { model_id_alias: alias, version, params_hash: hash, ...metrics, formula_version: formulaVersion, formula_constants: constants, source, cached: model !== null } };
}

// ── 1Hz 기록기 ──
async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(new TextEncoder().encode(text)).then(() => writer.close());
  return new Response(stream.readable).arrayBuffer();
}
const FLUSH_ROWS = 10;
const MAX_GAP_ROWS = 3600;

export class DisplayRecorder {
  private readonly queue: BiosignalQueue;
  private readonly session: BiosignalCaptureSession;
  private readonly viewKind: ViewKind;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly sourceFeature: SnapshotContext['sourceFeature'];
  private streamId = '';
  private viewInstanceId = '';
  private startMs = 0;
  private lastIndex = -1;
  private normalization: NormalizationSnapshot | null = null;
  private algorithm: AlgorithmSnapshot | null = null;
  private rows: DisplaySnapshotRow[] = [];
  private bundleSeq = 0;
  private modelSeen = false;
  private lastModel: NormalizationModelDto | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: { queue: BiosignalQueue; session: BiosignalCaptureSession; viewKind: ViewKind; createId?: () => string; now?: () => number; sourceFeature: SnapshotContext['sourceFeature'] }) {
    this.queue = options.queue; this.session = options.session; this.viewKind = options.viewKind;
    this.createId = options.createId ?? (() => crypto.randomUUID()); this.now = options.now ?? Date.now; this.sourceFeature = options.sourceFeature;
  }

  async start(model: NormalizationModelDto | null): Promise<void> {
    this.viewInstanceId = this.createId();
    this.streamId = this.session.streamId('eeg') ?? this.createId();
    this.startMs = this.now(); this.lastIndex = -1;
    const parameters = { rounding: 'math_round', mind_scale: '0-100', body: 'physical', hrv_metric: 'sdnn', tick_ms: 1000 };
    this.algorithm = { algorithm_id: 'mb-web-display', algorithm_version: '1', parameters, filter_version: '1', build: 'web',
      parameters_hash: await sha256(new TextEncoder().encode(JSON.stringify(parameters)).buffer as ArrayBuffer) };
    await this.setModel(model);
  }

  /** 모델이 바뀌면 새 snapshot을 등록한다. 이미 만든 행은 그 시점 snapshot을 그대로 가진다. */
  async setModel(model: NormalizationModelDto | null): Promise<void> {
    if (this.modelSeen && this.lastModel === model) return;
    this.modelSeen = true; this.lastModel = model;
    const { snapshot, alias } = await buildNormalizationSnapshot(model);
    if (this.normalization?.params_hash === snapshot.params_hash) return;
    this.normalization = snapshot;
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await this.queue.enqueueArtifact({ artifact_alias: alias, artifact_kind: 'normalization', stream_id: null, segment_id: null, signal: null, sequence: 0, row_count: 1, content_encoding: 'identity',
      schema_version: 'normalization-v1', checksum: await sha256(payload), size_bytes: payload.byteLength, content_type: 'application/json' }, payload);
  }

  /** 1초 타이머에서 호출. 지난 초를 못 그렸으면(타이머 정지·탭 비활성) not_rendered로 채운다. */
  tick(rendered: RenderedMetrics | null, visible: boolean): void {
    if (!this.viewInstanceId) return;
    const nowMs = this.now();
    const target = Math.floor((nowMs - this.startMs) / 1000) - 1;
    if (target <= this.lastIndex) return;
    const ctx = (): SnapshotContext => ({ streamId: this.streamId, viewInstanceId: this.viewInstanceId, viewKind: this.viewKind, nowMs, startMs: this.startMs,
      normalization: this.normalization, algorithm: this.algorithm, displayPipelineVersion: DISPLAY_PIPELINE_VERSION, sourceFeature: this.sourceFeature });
    const from = Math.max(this.lastIndex + 1, target - MAX_GAP_ROWS);
    for (let i = from; i < target; i++) this.rows.push(buildDisplaySnapshot(null, ctx(), i));
    this.rows.push(buildDisplaySnapshot(visible ? rendered : null, ctx(), target));
    this.lastIndex = target;
  }

  flush(force = false): Promise<void> {
    this.chain = this.chain.then(() => this.run(force)).catch(error => { console.error('display snapshot 묶음 실패 — 행 보존', error); });
    return this.chain;
  }
  private async run(force: boolean): Promise<void> {
    if (!this.rows.length || (!force && this.rows.length < FLUSH_ROWS)) return;
    const rows = this.rows; this.rows = [];
    try {
      const text = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
      const bytes = await gzip(text);
      const meta: ArtifactMeta = { artifact_alias: `IDX-${short(this.viewInstanceId)}-${String(this.bundleSeq).padStart(6, '0')}`, artifact_kind: 'indices', stream_id: this.streamId, segment_id: null, signal: null,
        view_instance_id: this.viewInstanceId, sequence: this.bundleSeq, first_sequence: rows[0].second_index, last_sequence: rows[rows.length - 1].second_index, row_count: rows.length,
        content_encoding: 'gzip', schema_version: 'indices-v1', checksum: await sha256(bytes), uncompressed_sha256: await sha256(new TextEncoder().encode(text).buffer as ArrayBuffer),
        size_bytes: bytes.byteLength, time_range: { from_us: String(rows[0].second_index * 1_000_000), to_us: String(rows[rows.length - 1].second_index * 1_000_000) }, content_type: 'application/gzip' };
      await this.queue.enqueueArtifact(meta, bytes);
      this.bundleSeq += 1;
      this.session.noteSnapshotSequence(this.streamId, this.viewInstanceId, rows[rows.length - 1].second_index);
    } catch (error) { this.rows = [...rows, ...this.rows]; throw error; }
  }
}
