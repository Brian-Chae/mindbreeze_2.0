import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { gunzipSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';
import { BiosignalQueue } from '../src/lib/biosignal/durable-queue';
import { BiosignalCaptureSession, type SampleWindow } from '../src/lib/biosignal/capture-session';
import { parseRawPacket } from '../src/lib/biosignal/raw-capture';
import { FeatureCollector } from '../src/lib/biosignal/feature-collector';
import { buildDisplaySnapshot, DisplayRecorder } from '../src/lib/biosignal/display-snapshot';
import type { NormalizationModelDto } from '../src/lib/api/normalization-api';
const scope = { accountId: 'review', sessionId: 'session', participantId: 'p', deviceAlias: 'band' };
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
async function setup() { const queue = new BiosignalQueue(scope, 'tab'); const session = new BiosignalCaptureSession({ queue }); await session.start(); return { queue, session }; }
const win = (signal: SampleWindow['signal'], segmentId = 'segment'): SampleWindow => ({ signal, streamId: `stream-${signal}`, segmentId, first: 0, end: 1, rate: 250, anchorUtcUs: '0', anchorRelUs: '0' });
const model = (id: number): NormalizationModelDto => ({ id, version: String(id), n_samples: 10, is_active: true, created_at: '', params: {} });
it.each([1, 2])('H01: %i번째 신호 묶음 저장 실패에도 미처리 신호와 오류를 보존', async failure => {
 const { queue, session } = await setup();
 vi.spyOn(session, 'sealedOverlap').mockImplementation(w => [{ signal: w.signal, streamId: w.streamId, segmentId: w.segmentId, alias: `RAW-${w.signal}`, sha256: 'a'.repeat(64), first: 0, end: 1 }]);
 const collector = new FeatureCollector({ queue, session });
 for (const signal of ['eeg', 'ppg', 'acc'] as const) collector.emit(signal, {}, { window: win(signal), windowIndex: 0 });
 const original = queue.enqueueArtifact.bind(queue); let count = 0;
 vi.spyOn(queue, 'enqueueArtifact').mockImplementation((meta, payload) => { if (meta.artifact_kind === 'raw_derived' && ++count === failure) return Promise.reject(new Error('disk failure')); return original(meta, payload); });
 await expect(collector.flush(true)).rejects.toThrow('disk failure');
 expect(collector.pendingCount).toBe(4 - failure);
 await collector.flush(true);
 expect((await queue.objects()).filter(o => o.kind === 'feature')).toHaveLength(3);
});
it('H08: A→B→A 정규화 모델은 모델별 슬롯이 다르고 같은 모델 슬롯을 재사용', async () => {
 const { queue, session } = await setup(); const recorder = new DisplayRecorder({ queue, session, viewKind: 'participant_player', sourceFeature: () => null });
 await recorder.start(model(1)); await recorder.setModel(model(2)); await recorder.setModel(model(1));
 const norms = (await queue.objects()).filter(o => o.kind === 'normalization');
 expect(norms).toHaveLength(2); expect(new Set(norms.map(o => 'sequence' in o.meta ? o.meta.sequence : null)).size).toBe(2);
});

it('H02: emit 직후 영속 journal에서 새 collector가 feature를 복원', async () => {
 const { queue, session } = await setup();
 vi.spyOn(session, 'sealedOverlap').mockImplementation(w => [{ signal: w.signal, streamId: w.streamId, segmentId: w.segmentId, alias: 'RAW', sha256: 'a'.repeat(64), first: 0, end: 1 }]);
 const collector = new FeatureCollector({ queue, session });
 collector.emit('eeg', {}, { window: win('eeg'), windowIndex: 0 });
 await collector.persist();
 const restored = new FeatureCollector({ queue, session }); await restored.restore(); await restored.flush(true);
 expect((await queue.objects()).filter(o => o.kind === 'feature')).toHaveLength(1);
});
it('H02: 표시 tick은 flush 이전에도 journal에 보존되고 새 recorder에서 복원', async () => {
 const { queue, session } = await setup(); let now = 1000;
 const recorder = new DisplayRecorder({ queue, session, viewKind: 'participant_player', sourceFeature: () => null, now: () => now });
 await recorder.start(null); now += 1000; recorder.tick(null, false); await recorder.persist();
 const restored = new DisplayRecorder({ queue, session, viewKind: 'participant_player', sourceFeature: () => null });
 await restored.start(null); await restored.flush(true);
 expect((await queue.objects()).filter(o => o.kind === 'indices')).toHaveLength(1);
});

it('H04: 패킷 tick 1초 공백은 시간축을 압축하지 않고 segment와 packet_gap으로 보존', async () => {
 const { queue, session } = await setup();
 for (const n of [0, 1]) { const bytes = new Uint8Array(74); new DataView(bytes.buffer).setUint32(0, n * 32768, true); session.receive(parseRawPacket('eeg', new DataView(bytes.buffer), String(10000000 + n * 1000000), String(1000000 + n * 1000000))); }
 await session.close('end'); const objects = (await queue.objects()).filter(o => o.kind === 'raw');
 expect(objects).toHaveLength(2);
 const headers = objects.map(o => (o.meta as import('../src/lib/api/biosignal').RawMeta).header);
 expect(BigInt(headers[1].anchor.utc_us!) - BigInt(headers[0].anchor.utc_us!)).toBe(1000000n);
 expect(session.sampleWindow('eeg', 10)?.anchorUtcUs).toBe(headers[1].anchor.utc_us);
 const gap = (await queue.pendingEvents()).find(e => e.event.event_type === 'gap' && e.event.reason === 'packet_gap')!.event;
 expect(gap).toMatchObject({ start_us: '10004000', end_us: '10964000' });
 expect((await queue.pendingEvents()).some(e => e.event.event_type === 'gap' && e.event.reason === 'packet_gap')).toBe(true);
});

it('M03: 표시하지 않는 지표는 숫자 대신 not_rendered 사유', () => {
 const input = { values: { focus: 70, relaxation: 60, emotional: 50, bpm: 70, respiration: 15, hrv: 40 }, rawMind: { focus: 1, relaxation: 1, emotional: 1 }, live: true, remoteRelaxation: false, blocked: false, leadOff: false, stale: false, lastEegAtMs: 1000, quality: 'ok', respirationNullReason: null, displayedKeys: ['relaxation'] as const };
 const row = buildDisplaySnapshot(input, { streamId: 's', viewInstanceId: 'v', viewKind: 'participant_player', nowMs: 1000, startMs: 0, normalization: null, algorithm: null, displayPipelineVersion: null, sourceFeature: () => null }, 0);
 expect(row.focus.value).toBeNull(); expect(row.focus.null_reason).toBe('not_rendered'); expect(row.relaxation.value).toBe(60);
});
it('H05: raw journal 실패 사본은 중단 후 저장 재시도·close에서도 복구된다', async () => {
 const { queue, session } = await setup();
 const write = vi.spyOn(queue, 'journalPacket').mockRejectedValueOnce(new Error('disk failure'));
 session.receive(parseRawPacket('eeg', new DataView(new Uint8Array(74).buffer), '10000000', '1000000'));
 await session.flush(); expect(session.stopReason).toBe('journal_failed');
 await session.sealOpen();
 expect(write).toHaveBeenCalledTimes(2);
 expect((await queue.objects()).filter(o => o.kind === 'raw')).toHaveLength(1);
});

it('H07: segment별 feature 순번은 0부터 시작하고 close 마지막값을 분리', async () => {
 const { queue, session } = await setup(); const collector = new FeatureCollector({ queue, session });
 for (const n of [0, 1]) {
  const bytes = new Uint8Array(74); new DataView(bytes.buffer).setUint32(0, n === 0 ? 327680 : 100, true);
  session.receive(parseRawPacket('eeg', new DataView(bytes.buffer), String(10000000 + n * 1000000), String(1000000 + n * 1000000)));
  await session.sealOpen();
  for (let count = 0; count < 2 - n; count++) collector.emit('eeg', {}, { window: session.sampleWindow('eeg', 10), windowIndex: count });
  await collector.flush(true);
 }
 const intent = await session.close('end');
 expect(intent.streams.map(s => s.last_feature_sequence)).toEqual([1, 0]);
 expect((await queue.objects()).filter(o => o.kind === 'feature').map(o => (o.meta as import('../src/lib/api/biosignal').ArtifactMeta).first_sequence)).toEqual([0, 0]);
});
it('H01/H02: derived 저장 뒤 feature 실패 + 새 emit에도 고정된 묶음을 재시도', async () => {
 const { queue, session } = await setup();
 vi.spyOn(session, 'sealedOverlap').mockImplementation(w => [{signal:w.signal,streamId:w.streamId,segmentId:w.segmentId,alias:'RAW',sha256:'a'.repeat(64),first:0,end:1}]);
 const collector = new FeatureCollector({ queue, session }); const original = queue.enqueueArtifact.bind(queue); let fail = true;
 vi.spyOn(queue,'enqueueArtifact').mockImplementation((meta,payload,drafts) => { if(meta.artifact_kind==='feature' && fail){fail=false;return Promise.reject(new Error('feature failed'));} return original(meta,payload,drafts); });
 collector.emit('eeg',{}, {window:win('eeg'),windowIndex:0}); await expect(collector.flush(true)).rejects.toThrow('feature failed');
 collector.emit('eeg',{}, {window:win('eeg'),windowIndex:1}); await collector.flush(true);
 expect((await queue.objects()).filter(o=>o.kind==='feature')).toHaveLength(2);
 expect(await queue.drafts('feature')).toHaveLength(0);
});

it('M02: 모델 변경 첫 record 호출은 새 값·새 모델·호출 시각을 함께 고정', async () => {
 const { queue, session } = await setup(); let now = 1000;
 const recorder = new DisplayRecorder({queue, session, viewKind:'participant_player', sourceFeature:()=>null, now:()=>now});
 await recorder.start(model(1)); now = 2000;
 const rendered = {values:{focus:70,relaxation:60,emotional:50,bpm:70,respiration:15,hrv:40},rawMind:{focus:1,relaxation:1,emotional:1},live:true,remoteRelaxation:false,blocked:false,leadOff:false,stale:false,lastEegAtMs:1000,quality:'ok',respirationNullReason:null};
 const pending = recorder.record(rendered,true,model(2)); now = 9000; await pending; await recorder.flush(true);
 const row = JSON.parse(gunzipSync(Buffer.from((await queue.objects()).find(o=>o.kind==='indices')!.payload)).toString().trim());
 expect(row.normalization.version).toBe('2'); expect(row.displayed_at_us).toBe('2000000'); expect(row.focus.value).toBe(70);
});
