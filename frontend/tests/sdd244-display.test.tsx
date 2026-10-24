// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { MemberClassView } from '../src/components/class/player/member/MemberClassView';
import { memberCaseViewProps } from '../src/lib/class/fixtures/member-cases';
import { PLAYER_METRICS } from '../src/lib/class/player-case';
import { BiosignalQueue, type CaptureScope } from '../src/lib/biosignal/durable-queue';
import { BiosignalCaptureSession } from '../src/lib/biosignal/capture-session';
import { buildDisplaySnapshot, buildNormalizationSnapshot, displayedInteger, DisplayRecorder, type RenderedMetrics } from '../src/lib/biosignal/display-snapshot';
import type { NormalizationModelDto } from '../src/lib/api/normalization-api';
import type { ArtifactMeta } from '../src/lib/api/biosignal';

const scope: CaptureScope = { accountId: 'a', sessionId: 's', participantId: 'p', deviceAlias: 'LINK-BAND' };
const rendered = (over: Partial<RenderedMetrics> = {}): RenderedMetrics => ({
  values: { focus: 62.4, relaxation: 70.5, emotional: 55, bpm: 72.4, respiration: 14.6, hrv: 38.2 },
  rawMind: { focus: 1.2, relaxation: 0.31, emotional: 2.2 }, live: true, remoteRelaxation: false, blocked: false, leadOff: false, stale: false,
  lastEegAtMs: 1_000_000, quality: 'ok', respirationNullReason: null, ...over });
const b0Metric = { m: null, s: null, direction: null, source: 'b0' as const, b0_version: 'haru-constants-v2-B0', fallback_reason: 'no_active_model' };
const b0Norm = { model_id_alias: 'NORM-B0TEST', version: 'b0', params_hash: 'a'.repeat(64), focus: b0Metric, relaxation: b0Metric, emotional: b0Metric, formula_version: 'cohort-b0-v2', formula_constants: {}, source: 'b0' as const, cached: false };
const algo = { algorithm_id: 'mb-web-display', algorithm_version: '1', parameters_hash: 'b'.repeat(64), parameters: { rounding: 'math_round' }, filter_version: '1', build: 'web' };
const ids = { streamId: '00000000-0000-4000-8000-000000000001', viewInstanceId: '00000000-0000-4000-8000-000000000002' };
const ctx = (over = {}) => ({ ...ids, viewKind: 'participant_player' as const, nowMs: 1_001_000, startMs: 1_000_000, normalization: b0Norm, algorithm: algo, displayPipelineVersion: 'member-player-1hz-v1', sourceFeature: (s: string) => (s === 'eeg' ? 'FEAT-EEG-1' : 'FEAT-PPG-1'), ...over });
const model = (id: number, focusM: number): NormalizationModelDto => ({ id, version: `v${id}`, n_samples: 10, is_active: true, created_at: '', params: { focusIndex: { m: focusM, s: 1, direction: 1 }, relaxationIndex: { m: 0.3, s: 0.1, direction: 1 }, emotionalStability: { m: 2, s: 1, direction: 1 } } });

describe('SDD244 T11 DisplaySnapshot 빌더', () => {
  it('화면이 쓰는 반올림 규칙 그대로 표시 정수·입력·정규화 출력을 담고 종합점수 필드가 없다', () => {
    const snap = buildDisplaySnapshot(rendered(), ctx(), 5);
    expect([snap.focus.value, snap.relaxation.value, snap.emotional.value, snap.bpm.value, snap.respiration.value, snap.hrv.value]).toEqual([62, 71, 55, 72, 15, 38]);
    expect(snap.focus).toMatchObject({ display_input: 1.2, normalized_output: 62.4, normalization_source: 'b0', input_source: 'local_ble', source_feature_id: 'FEAT-EEG-1' });
    expect(snap.bpm).toMatchObject({ display_input: 72.4, normalized_output: null, normalization_source: 'physical', source_feature_id: 'FEAT-PPG-1' });
    expect(snap.hrv_metric).toBe('sdnn');
    expect(snap).toMatchObject({ schema_version: 'indices-v1', render_status: 'rendered', source: 'displayed', display_match: true, second_index: 5, t_rel_ms: 5000 });
    expect(Object.keys(snap).some(k => /total|overall|composite|score/i.test(k))).toBe(false);
    expect(displayedInteger(62.5)).toBe(63); expect(displayedInteger(null)).toBeNull(); expect(displayedInteger(Number.NaN)).toBeNull();
  });
  it('접촉 불량·끊김 초도 null+사유로 저장한다(렌더됨)', () => {
    const lead = buildDisplaySnapshot(rendered({ values: { focus: null, relaxation: null, emotional: null, bpm: null, respiration: null, hrv: null }, blocked: true, leadOff: true }), ctx(), 1);
    expect(lead.render_status).toBe('rendered');
    expect(lead.focus).toMatchObject({ value: null, null_reason: 'lead_off', lead_off: true, normalization_source: 'unavailable' });
    const resp = buildDisplaySnapshot(rendered({ values: { focus: 50, relaxation: 50, emotional: 50, bpm: 60, respiration: null, hrv: 30 }, respirationNullReason: 'insufficient_window' }), ctx(), 2);
    expect(resp.respiration).toMatchObject({ value: null, null_reason: 'insufficient_window' });
    expect(resp.bpm.value).toBe(60);
  });
  it('원격 fallback 이완도는 출처를 remote_fallback+사유로 남기고 로컬 feature를 주장하지 않는다', () => {
    const snap = buildDisplaySnapshot(rendered({ live: false, remoteRelaxation: true, values: { focus: null, relaxation: 64, emotional: null, bpm: null, respiration: null, hrv: null }, rawMind: { focus: null, relaxation: null, emotional: null } }), ctx(), 3);
    expect(snap.relaxation).toMatchObject({ input_source: 'remote_fallback', source_feature_id: null, provenance_reason: 'remote_fallback_server_relaxation', value: 64 });
    expect(snap.focus.value).toBeNull();
  });
  it('미렌더 초는 값을 만들지 않고 not_rendered로 남긴다', () => {
    const snap = buildDisplaySnapshot(null, ctx(), 9);
    expect(snap).toMatchObject({ render_status: 'not_rendered', source: 'unavailable', display_match: 'unverified', unavailable_reason: 'not_rendered', displayed_at_us: null });
    for (const m of [snap.focus, snap.relaxation, snap.emotional, snap.bpm, snap.respiration, snap.hrv]) expect(m).toMatchObject({ value: null, null_reason: 'not_rendered' });
  });
});

describe('SDD244 T11 정규화 모델 snapshot', () => {
  beforeEachSetup();
  it('활성 모델이 없으면 B0(사유·버전), 있으면 표준 모델 m/s/direction을 hash와 함께 남긴다', async () => {
    const b0 = await buildNormalizationSnapshot(null);
    expect(b0.snapshot).toMatchObject({ source: 'b0', cached: false, focus: { m: null, source: 'b0', fallback_reason: 'no_active_model' } });
    expect(b0.snapshot.focus.b0_version).toMatch(/B0/);
    const std = await buildNormalizationSnapshot(model(1, 0.5));
    expect(std.snapshot).toMatchObject({ source: 'standard_model', cached: true, focus: { m: 0.5, s: 1, direction: 1, source: 'standard_model' } });
    const other = await buildNormalizationSnapshot(model(2, 0.9));
    expect(other.snapshot.params_hash).not.toBe(std.snapshot.params_hash);
    expect(other.alias).not.toBe(std.alias);
    const same = await buildNormalizationSnapshot(model(1, 0.5));
    expect(same.snapshot.params_hash).toBe(std.snapshot.params_hash);
  });
  it('일부 지표만 params가 있으면 mixed이고 없는 지표는 B0 사유를 남긴다', async () => {
    const partial = model(3, 0.5); delete partial.params.emotionalStability;
    const { snapshot } = await buildNormalizationSnapshot(partial);
    expect(snapshot.source).toBe('mixed');
    expect(snapshot.emotional).toMatchObject({ source: 'b0', fallback_reason: 'metric_params_missing' });
  });
});

function beforeEachSetup() {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
}

describe('SDD244 T11 1Hz 기록기', () => {
  beforeEachSetup();
  async function setup() {
    const queue = new BiosignalQueue(scope, 'tab-a');
    let id = 10; const createId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
    const session = new BiosignalCaptureSession({ queue, createId });
    await session.start();
    let now = 1_000_000;
    const recorder = new DisplayRecorder({ queue, session, viewKind: 'participant_player', createId, now: () => now, sourceFeature: () => 'FEAT-EEG-1' });
    return { queue, session, recorder, advance: (ms: number) => { now += ms; } };
  }
  const indicesRows = async (queue: BiosignalQueue) => {
    const objects = (await queue.objects()).filter(o => o.kind === 'indices');
    return objects.flatMap(o => gunzipSync(Buffer.from(o.payload)).toString().trim().split('\n').map(l => JSON.parse(l)));
  };

  it('활성 60초는 60개 slot을 second_index 0..59로 저장하고 모델 변경 뒤에도 과거 행 모델은 그대로다', async () => {
    const { queue, recorder, advance } = await setup();
    await recorder.start(model(1, 0.5));
    for (let s = 0; s < 60; s++) {
      if (s === 30) await recorder.setModel(model(2, 0.9));
      advance(1000); recorder.tick(rendered(), true);
    }
    await recorder.flush(true);
    const rows = await indicesRows(queue);
    expect(rows.map(r => r.second_index)).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(rows[0].normalization.focus.m).toBe(0.5); expect(rows[29].normalization.focus.m).toBe(0.5);
    expect(rows[30].normalization.focus.m).toBe(0.9); expect(rows[59].normalization.focus.m).toBe(0.9);
    const norms = (await queue.objects()).filter(o => o.kind === 'normalization');
    expect(norms).toHaveLength(2);
    const meta = (await queue.objects()).find(o => o.kind === 'indices')!.meta as ArtifactMeta;
    expect(createHash('sha256').update(Buffer.from((await queue.objects()).find(o => o.kind === 'indices')!.payload)).digest('hex')).toBe(meta.checksum);
    expect(meta).toMatchObject({ content_encoding: 'gzip', schema_version: 'indices-v1' });
  });

  it('타이머가 멈춘 구간과 탭 비활성 초는 not_rendered로 채운다', async () => {
    const { queue, recorder, advance } = await setup();
    await recorder.start(null);
    advance(1000); recorder.tick(rendered(), true);       // 0
    advance(4000); recorder.tick(rendered(), true);       // 지연: 1,2,3은 못 그림, 4는 렌더
    advance(1000); recorder.tick(rendered(), false);      // 5: 탭 숨김
    await recorder.flush(true);
    const rows = await indicesRows(queue);
    expect(rows.map(r => [r.second_index, r.render_status])).toEqual([[0, 'rendered'], [1, 'not_rendered'], [2, 'not_rendered'], [3, 'not_rendered'], [4, 'rendered'], [5, 'not_rendered']]);
    expect(rows[1].focus.value).toBeNull();
  });

  it('close intent에 마지막 snapshot 순번과 indices·normalization 객체가 들어간다', async () => {
    const { session, recorder, advance } = await setup();
    await recorder.start(model(1, 0.5));
    for (let s = 0; s < 3; s++) { advance(1000); recorder.tick(rendered(), true); }
    await recorder.flush(true);
    const intent = await session.close('user_end');
    expect(intent.snapshots).toEqual([{ stream_id: expect.any(String), view_instance_id: expect.any(String), last_snapshot_sequence: 2 }]);
    expect(intent.expected_artifacts.map(a => a.kind).sort()).toEqual(expect.arrayContaining(['indices', 'normalization']));
  });
});

describe('SDD244 T11 실제 DOM과 저장값 대조', () => {
  let root: Root; let box: HTMLDivElement;
  beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); box = document.createElement('div'); document.body.append(box); root = createRoot(box); });
  afterEach(async () => { await act(async () => root.unmount()); box.remove(); });
  it('MemberClassView 6지표 셀에 보이는 숫자 = 같은 snapshot으로 만든 저장 value', async () => {
    const values = { focus: 62.4, relaxation: 70.5, emotional: 55.49, bpm: 72.4, respiration: 14.6, hrv: 38.2 };
    const props = { ...memberCaseViewProps('M01', { sheet: 'status' }), snapshot: values };
    await act(async () => root.render(<MemberClassView {...props} />));
    const stored = buildDisplaySnapshot(rendered({ values }), ctx(), 0);
    const shown = new Map<string, string>();
    box.querySelectorAll('.mp-mcell').forEach(cell => shown.set(cell.querySelector('.mp-mcell__label')!.textContent!, cell.querySelector('.mp-mring__mv b')!.textContent!));
    const byKey = { focus: stored.focus, relaxation: stored.relaxation, emotional: stored.emotional, bpm: stored.bpm, respiration: stored.respiration, hrv: stored.hrv };
    expect(shown.size).toBe(6);
    for (const metric of PLAYER_METRICS) expect(shown.get(metric.label), metric.label).toBe(String(byKey[metric.key].value));
  });
});
