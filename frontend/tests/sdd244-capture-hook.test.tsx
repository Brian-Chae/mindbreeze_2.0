// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';

const api = vi.hoisted(() => ({ capability: vi.fn(), presign: vi.fn(), ack: vi.fn(), events: vi.fn() }));
const put = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/lib/api/biosignal', async importOriginal => ({ ...(await importOriginal<object>()), createBiosignalApi: () => api }));
vi.mock('../src/lib/api/eeg-raw', async importOriginal => ({ ...(await importOriginal<object>()), putEegRawToPresignedUrl: put }));

import { useBiosignalCapture, type UseBiosignalCaptureResult } from '../src/hooks/useBiosignalCapture';
import { captureRawPacket } from '../src/lib/biosignal/raw-capture';
import { BiosignalCaptureSession } from '../src/lib/biosignal/capture-session';
import { BiosignalQueue } from '../src/lib/biosignal/durable-queue';
import { useAuthStore } from '../src/stores/authStore';

const sessionId = '11111111-1111-4111-8111-111111111111', participantId = '22222222-2222-4222-8222-222222222222';
const capability = (over: object = {}) => ({ raw_schemas: ['mb-biosignal-raw-v2'], signals: [{ signal: 'eeg', upload_allowed: true, reason: null }, { signal: 'ppg', upload_allowed: false, reason: 'no_consent' }, { signal: 'acc', upload_allowed: true, reason: null }], artifact_kinds: [], events: true, upload_immutability: 'checksum_bound', ...over });
const eegPacket = () => { const bytes = new Uint8Array(4 + 7 * 10); return new DataView(bytes.buffer); };
const ppgPacket = () => new DataView(new Uint8Array(4 + 6).buffer);
let latest: UseBiosignalCaptureResult; let root: Root; let connected = true;
function Probe() { latest = useBiosignalCapture({ sessionId, participantId, enabled: true, connected }); return null; }
const settle = (ms = 30) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  Object.values(api).forEach(fn => fn.mockReset()); put.mockClear();
  useAuthStore.setState({ user: { id: 'user-1' } } as never);
  connected = true;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('SDD244 T08 useBiosignalCapture', () => {
  it('capability가 raw-v2를 모르면(구버전 서버) 구독하지 않고 기존 경로만 둔다', async () => {
    api.capability.mockResolvedValue(capability({ raw_schemas: [] }));
    await act(async () => root.render(<Probe />)); await settle();
    expect(api.capability).toHaveBeenCalled();
    captureRawPacket('eeg', eegPacket()); await settle();
    expect(latest.status).toBe('inactive');
    expect(api.presign).not.toHaveBeenCalled();
  });

  it('밴드를 연결한 적이 없으면 서버 요청 자체를 하지 않는다', async () => {
    connected = false;
    await act(async () => root.render(<Probe />)); await settle();
    expect(api.capability).not.toHaveBeenCalled();
  });

  it('동의된 신호만 수집하고 close가 PUT→ACK→intent 전송까지 수행한다(미동의 PPG는 수집 안 함)', async () => {
    api.capability.mockResolvedValue(capability());
    const aliases = new Map<string, string>();
    api.presign.mockImplementation(async (_s, _p, _k, meta: { chunk_alias: string; checksum: string; size_bytes: number }) => { aliases.set('srv', meta.chunk_alias); return { chunk_id: 'srv', chunk_alias: meta.chunk_alias, checksum: meta.checksum, size_bytes: meta.size_bytes, upload_url: 'https://s3/put', upload_headers: { a: 'b' }, upload_status: 'pending' }; });
    api.ack.mockImplementation(async (_s, _p, _k, id: string, checksum: string, size: number) => ({ chunk_id: id, chunk_alias: aliases.get(id), checksum, size_bytes: size, upload_status: 'uploaded', verified_at_us: '1', failure_reason: null }));
    api.events.mockResolvedValue({ events: [], manifest_revision: 1, close_state: 'pending_upload', missing_artifacts: [] });
    await act(async () => root.render(<Probe />)); await settle();
    expect(latest.status).toBe('running');
    act(() => { captureRawPacket('eeg', eegPacket()); captureRawPacket('ppg', ppgPacket()); });
    let intent: Awaited<ReturnType<typeof latest.close>> = null;
    await act(async () => { intent = await latest.close('user_end'); });
    expect(intent).not.toBeNull();
    expect(intent!.streams.map(s => s.signal)).toEqual(['eeg']);
    expect(put).toHaveBeenCalledWith('https://s3/put', expect.anything(), { a: 'b' });
    expect((put.mock.calls[0] as unknown as [string, ArrayBuffer])[1].byteLength).toBeGreaterThan(12);
    expect(api.events).toHaveBeenCalled();
    expect(latest.closeState).toBe('pending_upload');
  });
  it('H03: 오프라인 close 후 밴드 재연결 없이 online 이벤트로 영속 큐 업로드 재개', async () => {
    api.capability.mockResolvedValue(capability());
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await act(async () => root.render(<Probe />)); await settle();
    act(() => captureRawPacket('eeg', eegPacket()));
    await act(async () => { await latest.close('offline_end'); });
    expect(api.presign).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online')); await settle(100);
    expect(api.presign).toHaveBeenCalled();
  });

  it('H03: 밴드 없는 재마운트는 업로드만 복구하고 close 이후 새 표시 객체를 만들지 않는다', async () => {
    api.capability.mockResolvedValue(capability());
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await act(async () => root.render(<Probe />)); await settle();
    act(() => captureRawPacket('eeg', eegPacket()));
    await act(async () => { await latest.close('offline_end'); });
    await act(async () => root.unmount()); await settle();
    connected = false; Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const tickets = new Map<string, { chunk_id?: string; artifact_id?: string; chunk_alias?: string; artifact_alias?: string; checksum: string; size_bytes: number }>();
    api.presign.mockImplementation(async (_s, _p, kind, meta) => {
      const id = kind === 'raw' ? meta.chunk_alias : meta.artifact_alias;
      const ticket = { [kind === 'raw' ? 'chunk_id' : 'artifact_id']: id, [kind === 'raw' ? 'chunk_alias' : 'artifact_alias']: id, checksum: meta.checksum, size_bytes: meta.size_bytes };
      tickets.set(id, ticket); return { ...ticket, upload_url: null, upload_headers: {}, upload_status: 'uploaded' };
    });
    api.ack.mockImplementation(async (_s,_p,_kind,id) => ({...tickets.get(id),upload_status:'uploaded',verified_at_us:'1',failure_reason:null}));
    api.events.mockImplementation(async (_s,_p,events) => ({ events:events.map(e=>({event_type:e.event_type,event_id:e.intent_id ?? e.event_id,status:'recorded'})),close_state:'complete',manifest_revision:1,missing_artifacts:[] }));
    root = createRoot(document.createElement('div')); await act(async()=>root.render(<Probe/>)); await settle(120); await settle(120);
    expect(latest.status).toBe('stopped'); expect(latest.stopReason).toBe('closed');
    const queue = new BiosignalQueue({accountId:'user:user-1',sessionId,participantId,deviceAlias:'LINK-BAND'},'observer');
    expect(await queue.objects()).toHaveLength(0);
    act(()=>latest.recordDisplay(null,true)); await settle();
    expect(await queue.objects()).toHaveLength(0); expect(await queue.drafts('display')).toHaveLength(0);
  });

  it('H03: 느린 cleanup 중 즉시 재마운트는 lease 반환을 기다린 뒤 수집 재개', async () => {
    api.capability.mockResolvedValue(capability());
    await act(async()=>root.render(<Probe/>)); await settle(); expect(latest.status).toBe('running');
    let release!:()=>void; const barrier = new Promise<void>(resolve=>{release=resolve;});
    const original = BiosignalCaptureSession.prototype.sealOpen;
    const seal = vi.spyOn(BiosignalCaptureSession.prototype,'sealOpen').mockImplementationOnce(async function(){await barrier; return original.call(this);});
    await act(async()=>root.unmount()); root=createRoot(document.createElement('div'));
    await act(async()=>root.render(<Probe/>)); await settle();
    release(); await settle(100); await settle();
    expect(latest.status).toBe('running'); seal.mockRestore();
  });

});
