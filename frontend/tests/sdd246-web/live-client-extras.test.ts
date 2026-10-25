// SDD-246 T06 후속 — LiveClient: 명령 결과 Promise, live:metric emit, clock_probe, capture.*, paint ACK(live:rendered).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SID, snapshot } from './fixtures';
import { LiveClient, type LiveSocketLike, type RestFallback } from '../../src/lib/session-live/live-client';

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
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

async function ready() {
  const sock = new FakeSocket();
  let n = 0;
  let clock = 1_000;
  const client = new LiveClient({
    sessionId: SID, selfParticipantId: null, socket: sock, now: () => clock,
    uuid: () => `00000${(++n).toString().padStart(3, '0')}-0000-4000-8000-000000000000`,
    clientInstanceId: '00000050-0000-4000-8000-000000000050',
    rest: { getSnapshot: vi.fn(), postCommand: vi.fn() } as unknown as RestFallback,
  });
  client.start(); await flush();
  const join = sock.emitted[1]!.payload as { request_id: string; generation: string };
  sock.fire('live:snapshot', snapshot({ request_id: join.request_id, connection_generation: join.generation }));
  sock.fire('live:sync_complete', { session_id: SID, snapshot_id: snapshot().snapshot_id, through: [] });
  await flush();
  return { sock, client, tick: (ms: number) => { clock += ms; } };
}

describe('LiveClient 확장', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('request() 는 최종 ACK 로 resolve 하고 command_id 가 같다', async () => {
    const { sock, client } = await ready();
    sock.ackFor = (ev, p) => (ev === 'live:command'
      ? { command_id: (p as { command_id: string }).command_id, status: 'applied', epoch: '1', cursors: [], committed: true }
      : { ok: true });
    const ack = await client.request('session.start', {});
    expect(ack.status).toBe('applied');
    const sent = sock.emitted.filter((e) => e.ev === 'live:command').at(-1)!.payload as { command_id: string };
    expect(ack.command_id).toBe(sent.command_id);
  });

  it('request() 는 rejected ACK 도 값으로 돌려준다(예외 아님)', async () => {
    const { sock, client } = await ready();
    sock.ackFor = (ev, p) => (ev === 'live:command'
      ? { command_id: (p as { command_id: string }).command_id, status: 'rejected', code: 'forbidden', epoch: '1', cursors: [], committed: false }
      : { ok: true });
    const ack = await client.request('session.start', {});
    expect(ack).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('sendMetric 은 READY 에서만 live:metric 을 emit 한다', async () => {
    const { sock, client } = await ready();
    expect(client.sendMetric({ sequence: '1' })).toBe(true);
    expect(sock.emitted.at(-1)).toMatchObject({ ev: 'live:metric', payload: { sequence: '1' } });
    sock.connected = false;
    expect(client.sendMetric({ sequence: '2' })).toBe(false);
  });

  it('clockProbe 는 RTT·offset 을 계산한다', async () => {
    const { sock, client, tick } = await ready();
    sock.ackFor = (ev, p) => {
      if (ev !== 'live:clock_probe') return { ok: true };
      const q = p as { probe_id: string; client_monotonic_us: string };
      return { ok: true, probe_id: q.probe_id, client_monotonic_us: q.client_monotonic_us, server_receive_ms: 5_040, server_send_ms: 5_050 };
    };
    const pending = client.clockProbe(() => 1_000_000);
    tick(100);
    const r = await pending;
    expect(r?.probeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r?.serverReceiveMs).toBe(5_040);
  });

  it('paint ACK: markRendered 는 rendered_command_ids 를 즉시(배치 없이) applied 로 보낸다', async () => {
    const { sock, client } = await ready();
    client.markRendered(['00000099-0000-4000-8000-000000000099']);
    expect(sock.emitted.at(-1)).toMatchObject({ ev: 'live:applied', payload: { rendered_command_ids: ['00000099-0000-4000-8000-000000000099'] } });
  });

  it('live:rendered 를 받으면 입력→수신 왕복(monotonic)을 리스너에 알린다', async () => {
    const { sock, client, tick } = await ready();
    const seen: Array<{ commandId: string; rttMs: number }> = [];
    client.onRendered((m) => seen.push(m));
    sock.ackFor = () => ({ ok: true });
    const id = client.sendCommand('hand.set', { raised: true });
    tick(120);
    sock.fire('live:rendered', { command_id: id });
    expect(seen).toEqual([{ commandId: id, rttMs: 120 }]);
    sock.fire('live:rendered', { command_id: id }); // 중복은 한 번만
    expect(seen).toHaveLength(1);
  });
});
