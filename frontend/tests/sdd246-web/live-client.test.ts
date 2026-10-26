// SDD-246 T06 — LiveClient 전송 상태머신: hello→join→snapshot→applied→READY, command_id, REST 폴백, 손 변경 시 토큰 재발급 0.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PID, SID, event, metricsData, snapshot } from './fixtures';
import { LiveClient, type LiveSocketLike, type RestFallback } from '../../src/lib/session-live/live-client';
import { shouldRefreshMediaToken } from '../../src/lib/session-live/media-token-policy';

class FakeSocket implements LiveSocketLike {
  connected = true;
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  emitted: Array<{ ev: string; payload: unknown }> = [];
  ackFor: (ev: string, payload: unknown) => unknown = () => ({ ok: true });
  on(ev: string, fn: (...a: unknown[]) => void): void { this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]); }
  off(ev: string, fn: (...a: unknown[]) => void): void { this.handlers.set(ev, (this.handlers.get(ev) ?? []).filter((f) => f !== fn)); }
  emit(ev: string, payload: unknown, ack?: (r: unknown) => void): void {
    this.emitted.push({ ev, payload });
    if (ack) queueMicrotask(() => ack(this.ackFor(ev, payload)));
  }
  fire(ev: string, ...a: unknown[]): void { for (const f of this.handlers.get(ev) ?? []) f(...a); }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

function make(rest?: Partial<RestFallback>) {
  const sock = new FakeSocket();
  let n = 0;
  const client = new LiveClient({
    sessionId: SID,
    selfParticipantId: PID,
    socket: sock,
    now: () => 1_760_000_002_000,
    uuid: () => `00000${(++n).toString().padStart(3, '0')}-0000-4000-8000-000000000000`,
    clientInstanceId: '00000050-0000-4000-8000-000000000050',
    rest: { getSnapshot: vi.fn(), postCommand: vi.fn(), ...rest } as RestFallback,
  });
  return { sock, client };
}

describe('LiveClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hello→join→snapshot→applied 이후에만 READY, READY 에서 REST 폴링 0', async () => {
    const { sock, client } = make();
    client.start();
    await flush();
    expect(sock.emitted.map((e) => e.ev)).toEqual(['live:hello', 'live:join']);
    const join = sock.emitted[1]!.payload as { request_id: string; generation: string };
    expect(client.getState().phase).toBe('RESYNCING');
    sock.fire('live:snapshot', snapshot({ request_id: join.request_id, connection_generation: join.generation }));
    sock.fire('live:sync_complete', { session_id: SID, snapshot_id: snapshot().snapshot_id, through: [] });
    await flush();
    expect(sock.emitted.at(-1)).toMatchObject({ ev: 'live:applied' });
    expect(client.getState().phase).toBe('READY');
    const getSnapshot = (client as unknown as { rest: RestFallback }).rest.getSnapshot;
    for (let i = 0; i < 6; i += 1) {
      sock.fire('live:heartbeat', { session_id: SID, epoch: '1', through: [], auth_revision: '4', server_time_ms: 1 });
      vi.advanceTimersByTime(5_000);
    }
    expect(client.getState().phase).toBe('READY');
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('명령에는 항상 command_id 가 붙고, 손 내리기는 낙관 표시 후 ACK 로 정리', async () => {
    const { sock, client } = make();
    client.start(); await flush();
    const join = sock.emitted[1]!.payload as { request_id: string; generation: string };
    sock.fire('live:snapshot', snapshot({ request_id: join.request_id, connection_generation: join.generation }));
    sock.fire('live:sync_complete', { session_id: SID, snapshot_id: snapshot().snapshot_id, through: [] });
    await flush();
    sock.ackFor = (ev) => (ev === 'live:command'
      ? { command_id: 'x', status: 'applied', epoch: '1', cursors: [], committed: true }
      : { ok: true });
    const id = client.setHand(false);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const cmd = sock.emitted.at(-1)!.payload as { command_id: string; kind: string; payload: unknown; expected_epoch: string };
    expect(cmd).toMatchObject({ command_id: id, kind: 'hand.set', payload: { raised: false }, expected_epoch: '1' });
    expect(client.getState().intents[`hand:${PID}`]?.value).toBe(false);
    // ACK 의 command_id 는 서버가 돌려준 값으로 매칭한다
    sock.ackFor = () => ({ command_id: id, status: 'applied', epoch: '1', cursors: [], committed: true });
    sock.fire('live:ack', { command_id: id, status: 'applied', epoch: '1', cursors: [], committed: true });
    expect(client.getState().intents[`hand:${PID}`]).toBeUndefined();
  });

  it('transport down → DEGRADED, REST 폴백은 2초 후 시작하고 WS snapshot 적용 시 중단', async () => {
    const getSnapshot = vi.fn().mockResolvedValue(snapshot({ request_id: 'ignored' }));
    const { sock, client } = make({ getSnapshot });
    client.start(); await flush();
    sock.connected = false;
    sock.fire('disconnect', 'transport close');
    expect(client.getState().phase).toBe('DEGRADED');
    vi.advanceTimersByTime(1_900);
    expect(getSnapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    // 재연결 → 새 join → 완전 snapshot 적용 → 폴링 중단
    sock.connected = true;
    sock.fire('connect');
    await flush();
    const joins = sock.emitted.filter((e) => e.ev === 'live:join');
    const j = joins.at(-1)!.payload as { request_id: string; generation: string };
    sock.fire('live:snapshot', snapshot({ request_id: j.request_id, connection_generation: j.generation }));
    sock.fire('live:sync_complete', { session_id: SID, snapshot_id: snapshot().snapshot_id, through: [] });
    await flush();
    expect(client.getState().phase).toBe('READY');
    getSnapshot.mockClear();
    for (let i = 0; i < 4; i += 1) {
      sock.fire('live:heartbeat', { session_id: SID, epoch: '1', through: [], auth_revision: '4', server_time_ms: 1 });
      vi.advanceTimersByTime(5_000);
    }
    expect(client.getState().phase).toBe('READY');
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('heartbeat 10초 무응답이면 DEGRADED', async () => {
    const { sock, client } = make();
    client.start(); await flush();
    const join = sock.emitted[1]!.payload as { request_id: string; generation: string };
    sock.fire('live:snapshot', snapshot({ request_id: join.request_id, connection_generation: join.generation }));
    sock.fire('live:sync_complete', { session_id: SID, snapshot_id: snapshot().snapshot_id, through: [] });
    await flush();
    vi.advanceTimersByTime(10_500);
    expect(client.getState().phase).toBe('DEGRADED');
  });

  it('access_revoked 는 상태를 비우고 재join 을 하지 않는다', async () => {
    const { sock, client } = make();
    client.start(); await flush();
    sock.fire('live:access_revoked', { session_id: SID, code: 'consent_withdrawn', revision: '5' });
    expect(client.getState().phase).toBe('REVOKED');
    const before = sock.emitted.length;
    sock.fire('connect'); await flush();
    expect(sock.emitted.length).toBe(before);
  });

  it('metric 이벤트는 구독자에게 한 번만 알린다(상태 변경 없을 때 알림 0)', async () => {
    const { sock, client } = make();
    client.start(); await flush();
    const join = sock.emitted[1]!.payload as { request_id: string; generation: string };
    sock.fire('live:snapshot', snapshot({ request_id: join.request_id, connection_generation: join.generation }));
    sock.fire('live:sync_complete', { session_id: SID, snapshot_id: snapshot().snapshot_id, through: [] });
    await flush();
    const spy = vi.fn();
    client.subscribe(spy);
    const ev = event('metrics', 'metrics.updated', '42', '4', metricsData('42', 1_760_000_001_000, 70));
    sock.fire('live:event', ev);
    sock.fire('live:event', ev);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('미디어 토큰 정책 — 손만 바뀌면 재발급 0', () => {
  const base = { participantId: PID, canPublish: false, grantVersion: '1' };
  it('hand 변경(can_publish·grant_version 동일)은 재발급하지 않는다', () => {
    expect(shouldRefreshMediaToken(base, { ...base })).toBe(false);
  });
  it('can_publish 또는 grant_version 이 바뀔 때만 재발급', () => {
    expect(shouldRefreshMediaToken(base, { ...base, canPublish: true })).toBe(true);
    expect(shouldRefreshMediaToken(base, { ...base, grantVersion: '2' })).toBe(true);
  });
  it('처음 값(prev 없음)은 재발급 대상이 아니다(초기 연결은 별도)', () => {
    expect(shouldRefreshMediaToken(null, base)).toBe(false);
  });
});
