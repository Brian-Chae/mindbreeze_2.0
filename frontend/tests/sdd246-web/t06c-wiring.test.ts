// SDD-246 T06c — 측정 연결: 경로 판정(v2 off=현행, 미착용·미동의·미지원=측정 없음, 앱=native), WebMeasurementSession(raw→worker→live:metric),
// native 자격 인계(iOS registerCredential→credentialHandle, Android handoffCredentials)와 토큰 비반환.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PID, SID, STREAM } from './fixtures';
import { decideMeasurementPath } from '../../src/lib/measurement-web/measurement-path';
import { WebMeasurementSession } from '../../src/lib/measurement-web/web-measurement-session';
import type { WorkerLike } from '../../src/lib/measurement-web/capture-adapter';
import type { MetricEnvelope } from '../../src/lib/measurement-web/envelope';
import type { RawPacket } from '../../src/lib/biosignal/raw-types';
import { NativeMeasurementFacade } from '../../src/lib/native-measurement';
import type { NativeMeasurementPlugin } from '../../src/lib/native-measurement/types';
import type { CommandAck } from '../../src/lib/session-live/live-types';

const flush = async (): Promise<void> => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

describe('T06c — 측정 경로 판정', () => {
  const base = { v2: true, native: false, webBluetooth: true, bandConnected: true, eegConsent: true, bandOptIn: true };
  it('v2 off 면 현행(legacy) 그대로', () => {
    expect(decideMeasurementPath({ ...base, v2: false })).toBe('legacy');
  });
  it('미착용·EEG 미동의·LINK BAND 미선택·Web Bluetooth 미지원이면 측정 없음(off)', () => {
    expect(decideMeasurementPath({ ...base, bandConnected: false })).toBe('off');
    expect(decideMeasurementPath({ ...base, eegConsent: false })).toBe('off');
    expect(decideMeasurementPath({ ...base, bandOptIn: false })).toBe('off');
    expect(decideMeasurementPath({ ...base, webBluetooth: false })).toBe('off');
  });
  it('웹은 web_wasm, 앱(native)은 native facade 경로(웹 BLE 지원 여부 무관)', () => {
    expect(decideMeasurementPath(base)).toBe('web_wasm');
    expect(decideMeasurementPath({ ...base, native: true, webBluetooth: false })).toBe('native');
    expect(decideMeasurementPath({ ...base, native: true, eegConsent: false })).toBe('off');
  });
});

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: Array<{ msg: Record<string, unknown>; transfer?: Transferable[] }> = [];
  terminated = false;
  constructor(private readonly initOk = true) {}
  postMessage(msg: unknown, transfer?: Transferable[]): void {
    const m = msg as Record<string, unknown>;
    this.posted.push({ msg: m, transfer });
    if (m.type === 'init') queueMicrotask(() => this.onmessage?.({ data: this.initOk ? { type: 'ready' } : { type: 'init_error', message: 'wasm_unavailable' } }));
    if (m.type === 'close') queueMicrotask(() => this.onmessage?.({ data: { type: 'closed', final: { final_sequences: { eeg: '10', ppg: '2', acc: '3', metric: '4' }, segments: 1, raw_sha256: 'a'.repeat(64), feature_sha256: 'b'.repeat(64) } } }));
  }
  terminate(): void { this.terminated = true; }
  frames(envelopes: MetricEnvelope[]): void { this.onmessage?.({ data: { type: 'frames', envelopes, error: null } }); }
}

function rawPacket(tick: number): RawPacket {
  return { signal: 'eeg', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), rows: [], tickRaw: tick, malformedReason: null, receivedUtcUs: '1760000000000000', receivedMonotonicUs: '5000000' };
}

function deps(opts: { initOk?: boolean; startAck?: CommandAck } = {}) {
  const worker = new FakeWorker(opts.initOk ?? true);
  let rawFn: ((p: RawPacket) => void) | null = null;
  const unsub = vi.fn(() => { rawFn = null; });
  const calls: string[] = [];
  const batches: MetricEnvelope[][] = [];
  const client = {
    request: vi.fn(async (kind: string): Promise<CommandAck> => {
      calls.push(kind);
      if (kind === 'capture.start') {
        return opts.startAck ?? { command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true,
          result: { stream_id: STREAM, participant_id: PID, generation: '3', owner_generation: '3', lease: { expires_at_ms: 1 } } };
      }
      return { command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true };
    }),
    sendMetricBatch: vi.fn(async (w: MetricEnvelope[]) => { batches.push(w); return { kind: 'acks' as const, acks: [] }; }),
    sendDevice: vi.fn(async () => ({ kind: 'ack' as const, status: 'accepted' as const })),
    clockProbe: vi.fn(async () => null),
  };
  const createWorker = vi.fn(() => worker);
  const session = new WebMeasurementSession({
    client, sessionId: SID, createWorker,
    subscribeRaw: (fn) => { rawFn = fn; return unsub; },
    monotonicUs: () => 6_000_000, uuid: () => '0000000c-0000-4000-8000-00000000000c',
  });
  return { session, worker, client, calls, batches, createWorker, unsub, raw: (p: RawPacket) => rawFn?.(p), hasRaw: () => rawFn !== null };
}

const frame = (seq: string): MetricEnvelope => ({
  session_id: SID, participant_id: 'pending', stream_id: 'pending', stream_generation: '0', sequence: seq,
  window_start_us: '1', window_end_us: '2', observed_at_ms: 1, clock_anchor_id: 'pending', clock_uncertainty_ms: 300000,
  device_profile_version: 'linkband2-v1', algorithm_version: 'web-ts-1', model_version: 'b0-cohort-2',
  feature_hash: 'a'.repeat(64), contact: { fp1: 'contact', fp2: 'contact' }, sqi: 0.9, metrics: {},
});

describe('T06c — WebMeasurementSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('미착용·EEG 미동의면 워커·capture 요청·raw 구독 0', async () => {
    const d = deps();
    expect(await d.session.start({ eegConsent: false, bandConnected: true })).toBe('not_allowed');
    expect(await d.session.start({ eegConsent: true, bandConnected: false })).toBe('not_allowed');
    expect(d.createWorker).not.toHaveBeenCalled();
    expect(d.calls).toHaveLength(0);
    expect(d.hasRaw()).toBe(false);
  });

  it('WASM 코어를 못 올리면 서버 capture 요청 없이 core_unavailable(앱은 정상)', async () => {
    const d = deps({ initOk: false });
    expect(await d.session.start({ eegConsent: true, bandConnected: true })).toBe('core_unavailable');
    expect(d.calls).toHaveLength(0);
    expect(d.hasRaw()).toBe(false);
  });

  it('capture.start 거절이면 워커를 닫고 rejected', async () => {
    const d = deps({ startAck: { command_id: 'c', status: 'rejected', code: 'eeg_consent_required', epoch: '1', cursors: [], committed: false } });
    expect(await d.session.start({ eegConsent: true, bandConnected: true })).toBe('rejected');
    await flush();
    expect(d.worker.terminated).toBe(true);
    expect(d.hasRaw()).toBe(false);
  });

  it('raw 패킷은 복사본을 워커로 넘기고(원본 버퍼는 journal 소유라 detach 금지), 코어 frame 은 ACK 신원으로 live:metric 전송', async () => {
    const d = deps();
    expect(await d.session.start({ eegConsent: true, bandConnected: true })).toBe('capturing');
    const p = rawPacket(777);
    d.raw(p);
    const pkt = d.worker.posted.find((x) => x.msg.type === 'packet')!;
    expect(pkt.msg).toMatchObject({ sensor: 'eeg', arrivalUs: 5_000_000, wallMs: 1_760_000_000_000, anchorUs: 5_000_000 });
    expect((pkt.msg.bytes as Uint8Array).buffer).not.toBe(p.bytes.buffer);
    expect(p.bytes.byteLength).toBe(11); // 원본 유지
    d.worker.frames([frame('1')]);
    await flush();
    expect(d.batches[0]![0]).toMatchObject({ participant_id: PID, stream_id: STREAM, stream_generation: '3', sequence: '1' });
  });

  it('1초 tick 마다 advance(gap 프레임)를 보낸다', async () => {
    const d = deps();
    await d.session.start({ eegConsent: true, bandConnected: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(d.worker.posted.some((x) => x.msg.type === 'advance' && x.msg.monoUs === 6_000_000)).toBe(true);
  });

  it('stop 은 코어 final_sequences 로 capture.close, raw 구독·워커 정리', async () => {
    const d = deps();
    await d.session.start({ eegConsent: true, bandConnected: true });
    await d.session.stop('user_left');
    expect(d.calls.at(-1)).toBe('capture.close');
    const close = d.client.request.mock.calls.at(-1)!;
    expect(close[1]).toMatchObject({ stream_id: STREAM, reason: 'user_left', final_sequences: { eeg: '10', ppg: '2', acc: '3', metric: '4' } });
    expect(d.unsub).toHaveBeenCalled();
    expect(d.worker.terminated).toBe(true);
  });

  it('서버가 stream 을 끊으면(device.changed revoked) 요청 없이 로컬 수집을 멈춘다', async () => {
    const d = deps();
    await d.session.start({ eegConsent: true, bandConnected: true });
    d.session.observeDevice({ participant_id: PID, stream_id: STREAM, generation: '3', status: 'revoked', cutoff_code: 'removed' });
    await flush();
    expect(d.session.status()).toBe('stopped');
    expect(d.calls.includes('capture.close')).toBe(false);
    expect(d.unsub).toHaveBeenCalled();
  });

  it('밴드 상태는 바뀔 때만 live:device 로 보고한다', async () => {
    const d = deps();
    await d.session.start({ eegConsent: true, bandConnected: true });
    const band = { band_state: 'connected' as const, contact: { fp1: 'contact', fp2: 'contact' }, sqi: 0.8, battery_pct: 90, state_reason: null };
    await d.session.reportBand(band);
    await d.session.reportBand({ ...band });
    await d.session.reportBand({ ...band, battery_pct: 89 });
    expect(d.client.sendDevice).toHaveBeenCalledTimes(2);
  });
});

describe('T06c — native 자격 인계(토큰은 결과·이벤트로 돌아오지 않는다)', () => {
  const tokens = { accessToken: 'AT-secret-value-1234', refreshToken: 'RT-secret-value-5678' };
  function plugin(over: Partial<NativeMeasurementPlugin> = {}): NativeMeasurementPlugin {
    return {
      getCapabilities: vi.fn(),
      startMeasurement: vi.fn(async () => ({ managerId: '0000000d-0000-4000-8000-00000000000d', streamId: STREAM, ownerGeneration: '1' })),
      getMeasurementSnapshot: vi.fn(),
      dispatchLiveCommand: vi.fn(),
      stopMeasurement: vi.fn(),
      addListener: vi.fn(async () => ({ remove: async () => undefined })),
      setNativeOwnership: vi.fn(async () => ({ enabled: true })),
      setJSBandOwnership: vi.fn(async () => ({ accepted: true })),
      registerCredential: vi.fn(async () => ({ credentialHandle: 'handle_ABCDEFGHIJKLMNOP' })),
      handoffCredentials: vi.fn(async () => ({ handoff: true })),
      ...over,
    } as NativeMeasurementPlugin;
  }
  const common = { sessionId: SID, requestId: '0000000e-0000-4000-8000-00000000000e', accountId: 'acct-1', apiBase: 'https://api.example', socketBase: 'https://ws.example', configHash: 'f'.repeat(64), instanceId: '0000000f-0000-4000-8000-00000000000f', tokens };

  it('iOS: setNativeOwnership → registerCredential → credentialHandle 로 startMeasurement(토큰 미전달)', async () => {
    const p = plugin();
    const f = new NativeMeasurementFacade(p);
    const r = await f.startWithCredentials({ ...common, platform: 'ios' });
    expect(p.setNativeOwnership).toHaveBeenCalledWith({ enabled: true });
    expect(p.registerCredential).toHaveBeenCalledWith({ accountId: 'acct-1', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, apiBase: 'https://api.example' });
    const startArg = (p.startMeasurement as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(startArg).toEqual({ sessionId: SID, credentialHandle: 'handle_ABCDEFGHIJKLMNOP', configHash: 'f'.repeat(64), requestId: common.requestId });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it('Android: handoffCredentials 후 startMeasurement(apiBase/socketBase/instanceId), 토큰은 start 에 싣지 않는다', async () => {
    const p = plugin();
    const f = new NativeMeasurementFacade(p);
    await f.startWithCredentials({ ...common, platform: 'android' });
    expect(p.handoffCredentials).toHaveBeenCalledWith({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    const startArg = (p.startMeasurement as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(JSON.stringify(startArg)).not.toContain('secret');
    expect(startArg).toMatchObject({ sessionId: SID, apiBase: 'https://api.example', socketBase: 'https://ws.example', requestId: common.requestId, instanceId: common.instanceId });
  });

  it('native 가 결과에 토큰을 되돌리면 거절하고 값은 오류 메시지에도 싣지 않는다', async () => {
    const p = plugin({ registerCredential: vi.fn(async () => ({ credentialHandle: 'handle_ABCDEFGHIJKLMNOP', accessToken: tokens.accessToken })) as never });
    const f = new NativeMeasurementFacade(p);
    const err = await f.startWithCredentials({ ...common, platform: 'ios' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('credential_echo');
    expect(p.startMeasurement).not.toHaveBeenCalled();
  });

  it('토큰 모양 필드를 실은 bridge 이벤트는 버린다', async () => {
    let listener: ((e: unknown) => void) | null = null;
    const p = plugin({
      addListener: vi.fn(async (_n: string, fn: (e: unknown) => void) => { listener = fn; return { remove: async () => undefined }; }) as never,
      getMeasurementSnapshot: vi.fn(async () => ({ bridge_version: 1, managerGeneration: '1', seq: '1', sessionId: SID })) as never,
    });
    const f = new NativeMeasurementFacade(p);
    const acks: unknown[] = [];
    f.onCommandAck((a) => acks.push(a));
    await f.attach(SID);
    listener!({ bridge_version: 1, managerGeneration: '1', seq: '2', emitted_at_native_ms: 1, event: 'commandAck', payload: { sessionId: SID, ack: { command_id: 'x', refreshToken: 'leak' } } });
    listener!({ bridge_version: 1, managerGeneration: '1', seq: '3', emitted_at_native_ms: 1, event: 'commandAck', payload: { sessionId: SID, ack: { command_id: 'y', status: 'applied' } } });
    expect(acks).toEqual([{ command_id: 'y', status: 'applied' }]);
    expect(f.droppedSecretEvents()).toBe(1);
  });

  it('같은 requestId 재호출은 인계·start 를 다시 하지 않는다(멱등)', async () => {
    const p = plugin();
    const f = new NativeMeasurementFacade(p);
    await Promise.all([f.startWithCredentials({ ...common, platform: 'ios' }), f.startWithCredentials({ ...common, platform: 'ios' })]);
    expect(p.registerCredential).toHaveBeenCalledTimes(1);
    expect(p.startMeasurement).toHaveBeenCalledTimes(1);
  });
});
