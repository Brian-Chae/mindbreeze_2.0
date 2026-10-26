// SDD-246 T06 — native-measurement facade(contracts/measurement-bridge): 세대·seq 검사, 중복 시작 방지, 웹 폴백, 업로드 상태 표시.
import { describe, expect, it, vi } from 'vitest';
import { NativeMeasurementFacade, type NativeMeasurementPlugin, type BridgeEvent } from '../../src/lib/native-measurement';
import { describeArchiveStatus } from '../../src/lib/native-measurement/archive-status';

const SESSION = '00000001-0000-4000-8000-000000000001';

function snapshotMsg(seq: string, gen = '1') {
  return {
    bridge_version: 1, managerGeneration: gen, seq, sessionId: SESSION, state: 'CAPTURING', blocked_reason: null,
    streamId: '00000014-0000-4000-8000-000000000014', ownerGeneration: '3',
    versions: { native_runtime: 'n', core: 'c', algorithm: 'a', model: 'm', device_profile: 'd' },
    metrics: null,
    collection: { band_state: 'connected', last_committed_sample_sequence: '1', counters: { packets: { eeg: '1', ppg: '1', acc: '1' }, samples: { eeg: '1', ppg: '1', acc: '1' }, native_metric_windows: '1', native_heartbeat: '1', js_heartbeat_independent: true } },
    live: { socket: 'ready', last_ack_sequence: null, snapshot_through: [] },
    archive: { queue: { live_pending: 0, live_acked: 0, archive_pending: 0, archive_verified: 0, pending_authorization: 0, pending_time_review: 0, oldest_pending_age_ms: null, disk_used_bytes: 0, disk_limit_bytes: 536870912 }, last_verified_at_ms: null },
    gaps: [],
  };
}

function fakePlugin() {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const plugin = {
    getCapabilities: vi.fn().mockResolvedValue({ bridge_version: 1, platform: 'ios' }),
    startMeasurement: vi.fn().mockResolvedValue({ managerId: 'm', streamId: 's', ownerGeneration: '1' }),
    getMeasurementSnapshot: vi.fn().mockResolvedValue(snapshotMsg('10')),
    dispatchLiveCommand: vi.fn().mockResolvedValue({ command_id: 'c', accepted_for_send: true, queued_at_native_ms: 1 }),
    stopMeasurement: vi.fn().mockResolvedValue({ accepted: true }),
    addListener: vi.fn(async (ev: string, fn: (e: unknown) => void) => {
      listeners.set(ev, [...(listeners.get(ev) ?? []), fn]);
      return { remove: async () => { listeners.set(ev, (listeners.get(ev) ?? []).filter((f) => f !== fn)); } };
    }),
  } as unknown as NativeMeasurementPlugin;
  const fire = (ev: string, e: unknown) => (listeners.get(ev) ?? []).forEach((f) => f(e));
  return { plugin, fire, listeners };
}

const ev = (event: string, gen: string, seq: string, payload: unknown): BridgeEvent =>
  ({ bridge_version: 1, event, managerGeneration: gen, seq, emitted_at_native_ms: 1, payload }) as unknown as BridgeEvent;

describe('NativeMeasurementFacade', () => {
  it('foreground 복귀: full snapshot 을 먼저 받은 뒤 그보다 새로운 event 만 반영한다', async () => {
    const { plugin, fire } = fakePlugin();
    const f = new NativeMeasurementFacade(plugin);
    const seen: string[] = [];
    f.onMeasurement((s) => seen.push(s.seq));
    await f.attach(SESSION);
    expect(seen).toEqual(['10']);
    fire('measurementUpdated', ev('measurementUpdated', '1', '9', snapshotMsg('9'))); // 과거 → 폐기
    fire('measurementUpdated', ev('measurementUpdated', '1', '11', snapshotMsg('11')));
    expect(seen).toEqual(['10', '11']);
  });

  it('이전 managerGeneration 이벤트는 폐기하고 새 세대는 snapshot 재조회', async () => {
    const { plugin, fire } = fakePlugin();
    const f = new NativeMeasurementFacade(plugin);
    const seen: string[] = [];
    f.onMeasurement((s) => seen.push(`${s.managerGeneration}:${s.seq}`));
    await f.attach(SESSION);
    (plugin.getMeasurementSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotMsg('3', '2'));
    fire('measurementUpdated', ev('measurementUpdated', '2', '1', snapshotMsg('1', '2')));
    await Promise.resolve(); await Promise.resolve();
    expect(seen.at(-1)).toBe('2:3');
    fire('measurementUpdated', ev('measurementUpdated', '1', '50', snapshotMsg('50', '1')));
    expect(seen.at(-1)).toBe('2:3');
  });

  it('start 는 같은 requestId 로 한 번만 보내고 attach 가 중복 수집을 시작하지 않는다', async () => {
    const { plugin } = fakePlugin();
    const f = new NativeMeasurementFacade(plugin);
    await f.attach(SESSION);
    await f.attach(SESSION);
    expect(plugin.startMeasurement).not.toHaveBeenCalled();
    const a = f.start({ sessionId: SESSION, credentialHandle: 'cred_handle_AbCdEfGh0123', configHash: 'a'.repeat(64), requestId: '0000001e-0000-4000-8000-00000000001e' });
    const b = f.start({ sessionId: SESSION, credentialHandle: 'cred_handle_AbCdEfGh0123', configHash: 'a'.repeat(64), requestId: '0000001e-0000-4000-8000-00000000001e' });
    await Promise.all([a, b]);
    expect(plugin.startMeasurement).toHaveBeenCalledTimes(1);
  });

  it('stale listener 제거: detach 후 이벤트는 전달되지 않는다', async () => {
    const { plugin, fire } = fakePlugin();
    const f = new NativeMeasurementFacade(plugin);
    const seen: string[] = [];
    f.onMeasurement((s) => seen.push(s.seq));
    await f.attach(SESSION);
    await f.detach();
    fire('measurementUpdated', ev('measurementUpdated', '1', '99', snapshotMsg('99')));
    expect(seen).toEqual(['10']);
  });

  it('commandAck 는 별도 콜백으로 전달된다(웹뷰가 socket writer 를 만들지 않음)', async () => {
    const { plugin, fire } = fakePlugin();
    const f = new NativeMeasurementFacade(plugin);
    const acks: unknown[] = [];
    f.onCommandAck((a) => acks.push(a));
    await f.attach(SESSION);
    fire('commandAck', ev('commandAck', '1', '20', { sessionId: SESSION, ack: { command_id: 'c', status: 'applied', epoch: '1', cursors: [], committed: true } }));
    expect(acks).toHaveLength(1);
  });
});

describe('업로드 상태 표시 — 보류 / 확인 필요 구분', () => {
  const q = (o: Partial<{ archive_pending: number; pending_authorization: number; pending_time_review: number; oldest_pending_age_ms: number | null }>) => ({
    live_pending: 0, live_acked: 0, archive_pending: 0, archive_verified: 0, pending_authorization: 0,
    pending_time_review: 0, oldest_pending_age_ms: null, disk_used_bytes: 0, disk_limit_bytes: 536870912, ...o,
  });
  it('대기만 있으면 "보류"(자동 재시도), 사람 확인이 필요하면 "확인 필요"', () => {
    expect(describeArchiveStatus(q({}), null).kind).toBe('ok');
    const hold = describeArchiveStatus(q({ archive_pending: 3 }), null);
    expect(hold.kind).toBe('hold');
    expect(hold.label).toBe('보류');
    const review = describeArchiveStatus(q({ pending_time_review: 1 }), null);
    expect(review.kind).toBe('needs_review');
    expect(review.label).toBe('확인 필요');
    expect(describeArchiveStatus(q({ pending_authorization: 2 }), null).kind).toBe('needs_review');
    expect(describeArchiveStatus(q({ archive_pending: 3 }), 'storage_full').kind).toBe('needs_review');
  });
  it('확인 필요가 보류보다 우선하고 두 문구는 서로 다르다', () => {
    const both = describeArchiveStatus(q({ archive_pending: 5, pending_time_review: 1 }), null);
    expect(both.kind).toBe('needs_review');
    expect(describeArchiveStatus(q({ archive_pending: 1 }), null).detail).not.toBe(both.detail);
  });
});
