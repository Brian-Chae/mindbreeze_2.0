// SDD-246 T06 — session-live v2 전송 클라이언트(웹 JS). LiveState reducer 만 상태를 바꾼다.
// 상태머신: CONNECTING → RESYNCING → READY → DEGRADED → RESYNCING, TERMINAL, REVOKED (plan §3.5)
//  - READY 에서는 REST 폴링 0. 전송 장애/heartbeat 10초 무응답이면 DEGRADED + REST 폴백(2초 후, 최대 5초 간격).
//  - 모든 명령에 command_id(UUID). timeout 2초 → 같은 ID 재시도(0.5/1/2/4초), 이후 resync.
//  - 낙관 표시는 intents 에만 둔다(상태 직접 변경 금지). 오래된 실패 ACK 는 새 intent 를 롤백하지 못한다.
import {
  addIntent, applyEvent, applyHeartbeat, applyRestSnapshot, applyRevoked, applySnapshot, applyTerminal,
  beginResync, createLiveState, markDegraded, pruneIntents, resolveIntent,
  type LiveEffect, type LiveState,
} from './live-state';
import type {
  CommandAck, CommandKind, HeartbeatMessage, LiveCommand, LiveEvent, LiveSnapshot, ResyncReason,
} from './live-types';

export interface LiveSocketLike {
  connected: boolean;
  on(ev: string, fn: (...a: unknown[]) => void): void;
  off(ev: string, fn: (...a: unknown[]) => void): void;
  emit(ev: string, payload: unknown, ack?: (res: unknown) => void): void;
}

export interface RestFallback {
  getSnapshot(args: { sessionId: string; requestId: string; generation: string }): Promise<LiveSnapshot>;
  postCommand(cmd: LiveCommand): Promise<CommandAck>;
}

export interface LiveClientOptions {
  sessionId: string;
  /** 본인 participant id — 손 intent 키 */
  selfParticipantId: string | null;
  socket: LiveSocketLike;
  rest: RestFallback;
  uuid: () => string;
  clientInstanceId: string;
  now?: () => number;
  appBuild?: string;
  capabilities?: string[];
  coreVersion?: string | null;
  entryCredential?: string | null;
}

export const HEARTBEAT_TIMEOUT_MS = 10_000;
export const REST_FIRST_DELAY_MS = 2_000;
export const REST_MAX_INTERVAL_MS = 5_000;
export const COMMAND_TIMEOUT_MS = 2_000;
const RETRY_BACKOFF_MS = [500, 1_000, 2_000, 4_000];
const APPLIED_BATCH_MS = 1_000;
const PRESENCE_MS = 5_000;

interface Pending {
  cmd: LiveCommand;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

type Listener = (s: LiveState) => void;
type Handler = (...a: unknown[]) => void;

export class LiveClient {
  private readonly o: LiveClientOptions;
  readonly rest: RestFallback;
  private state: LiveState;
  private generation = 0;
  private listeners = new Set<Listener>();
  private handlers: Array<[string, Handler]> = [];
  private pending = new Map<string, Pending>();
  private hbTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private appliedTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTicket = 0;
  private pollCount = 0;
  private awaitingSyncSnapshotId: string | null = null;
  private started = false;
  private waiters = new Map<string, Array<(ack: CommandAck) => void>>();
  private sentAtMs = new Map<string, number>();
  private renderedListeners = new Set<(m: { commandId: string; rttMs: number }) => void>();

  constructor(o: LiveClientOptions) {
    this.o = o;
    this.rest = o.rest;
    this.state = createLiveState({ sessionId: o.sessionId });
  }

  getState(): LiveState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const on = (ev: string, fn: Handler): void => {
      this.handlers.push([ev, fn]);
      this.o.socket.on(ev, fn);
    };
    on('connect', () => this.handshake());
    on('disconnect', () => this.onTransportDown());
    on('live:snapshot', (s) => this.onSnapshot(s as LiveSnapshot));
    on('live:sync_complete', (m) => this.onSyncComplete(m as { snapshot_id: string }));
    on('live:event', (e) => this.onEvent(e as LiveEvent));
    on('live:heartbeat', (h) => this.onHeartbeat(h as HeartbeatMessage));
    on('live:ack', (a) => this.handleAck(a as CommandAck));
    on('live:access_revoked', (m) => this.onRevoked((m as { code?: string }).code ?? 'revoked'));
    on('live:terminal', () => this.onTerminal());
    on('live:resync_required', () => this.resync('server_requested'));
    on('live:degraded', () => this.degrade());
    on('live:rendered', (m) => this.onRenderedMsg(m as { command_id?: string }));
    if (this.o.socket.connected) this.handshake();
  }

  stop(): void {
    for (const [ev, fn] of this.handlers) this.o.socket.off(ev, fn);
    this.handlers = [];
    this.clearTimers();
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
    this.resolveAllWaiters('stopped');
    this.started = false;
  }

  private resolveAllWaiters(code: string): void {
    for (const [id, list] of this.waiters) {
      const ack: CommandAck = { command_id: id, status: 'rejected', epoch: this.state.epoch ?? '0', cursors: [], committed: false, code };
      for (const fn of list) fn(ack);
    }
    this.waiters.clear();
  }

  private settle(ack: CommandAck): void {
    const list = this.waiters.get(ack.command_id);
    if (!list) return;
    this.waiters.delete(ack.command_id);
    for (const fn of list) fn(ack);
  }

  // ── 상태 반영 ───────────────────────────────────────────────
  private set(next: LiveState): void {
    if (next === this.state) return;
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }

  private run(effects: LiveEffect[]): void {
    for (const e of effects) {
      if (e.type === 'resync') this.resync(e.reason);
      else if (e.type === 'stop_polling') this.stopPolling();
      else if (e.type === 'send_applied') this.awaitingSyncSnapshotId = e.snapshotId;
    }
  }

  private isReady(): boolean {
    return this.state.phase === 'READY';
  }

  private terminalOrRevoked(): boolean {
    return this.state.phase === 'TERMINAL' || this.state.phase === 'REVOKED';
  }

  // ── 연결·동기화 ─────────────────────────────────────────────
  private handshake(): void {
    if (this.terminalOrRevoked()) return;
    const { socket } = this.o;
    socket.emit('live:hello', {
      protocol_version: 2,
      schema_version: 1,
      supported_protocol_versions: [2],
      app_build: this.o.appBuild ?? 'web',
      client_instance_id: this.o.clientInstanceId,
      capabilities: this.o.capabilities ?? [],
      core_version: this.o.coreVersion ?? null,
    }, (res) => {
      const r = res as { ok?: boolean; code?: string; retryable?: boolean } | undefined;
      if (r && r.ok === false) { this.onJoinFailure(r.code ?? 'hello_failed', Boolean(r.retryable)); return; }
      this.join();
    });
  }

  private nextExpected(): { requestId: string; generation: string } {
    this.generation += 1;
    return { requestId: this.o.uuid(), generation: String(this.generation) };
  }

  private join(): void {
    if (this.terminalOrRevoked()) return;
    const exp = this.nextExpected();
    this.set(beginResync(this.state, exp));
    this.o.socket.emit('live:join', {
      protocol_version: 2,
      schema_version: 1,
      session_id: this.o.sessionId,
      request_id: exp.requestId,
      generation: exp.generation,
      last_cursors: [],
      entry_credential: this.o.entryCredential ?? null,
    }, (res) => {
      const r = res as { ok?: boolean; code?: string; retryable?: boolean } | undefined;
      if (r && r.ok === false) this.onJoinFailure(r.code ?? 'join_failed', Boolean(r.retryable));
    });
  }

  private onJoinFailure(code: string, retryable: boolean): void {
    if (code === 'access_revoked') { this.onRevoked(code); return; }
    if (code === 'upgrade_required' || code === 'protocol_v1_session') { this.degrade(); return; }
    this.degrade();
    if (retryable) setTimeout(() => { if (!this.terminalOrRevoked() && this.o.socket.connected) this.handshake(); }, 1_000);
  }

  private resync(reason: ResyncReason): void {
    if (this.terminalOrRevoked()) return;
    const exp = this.nextExpected();
    this.set(beginResync(this.state, exp));
    if (!this.o.socket.connected) { this.degrade(); return; }
    this.o.socket.emit('live:resync', {
      protocol_version: 2,
      schema_version: 1,
      session_id: this.o.sessionId,
      reason,
      request_id: exp.requestId,
      last_cursors: Object.entries(this.state.cursors).map(([k, seq]) => {
        const [audience, domain] = k.split('|');
        return { audience: audience ?? '', domain: domain ?? '', seq };
      }),
    });
  }

  private onSnapshot(snap: LiveSnapshot): void {
    const r = applySnapshot(this.state, snap);
    if (!r.applied) return;
    this.set(r.state);
    this.run(r.effects);
    this.armHeartbeatWatchdog();
    this.startPresence();
    if (r.state.phase === 'TERMINAL') this.clearTimers();
  }

  private onSyncComplete(m: { snapshot_id: string }): void {
    if (this.awaitingSyncSnapshotId !== m.snapshot_id) return;
    this.awaitingSyncSnapshotId = null;
    this.o.socket.emit('live:applied', {
      protocol_version: 2,
      schema_version: 1,
      session_id: this.o.sessionId,
      snapshot_id: m.snapshot_id,
      cursors: this.cursorList(),
    });
  }

  private cursorList(): Array<{ audience: string; domain: string; seq: string }> {
    return Object.entries(this.state.cursors).map(([k, seq]) => {
      const [audience, domain] = k.split('|');
      return { audience: audience ?? '', domain: domain ?? '', seq };
    });
  }

  private onEvent(ev: LiveEvent): void {
    const r = applyEvent(this.state, ev);
    this.set(r.state);
    this.run(r.effects);
    if (r.state.phase === 'READY') this.scheduleApplied();
    // paint ACK: 내가 보낸 명령이 아닌 타인의 명령 event 는, 화면에 반영된 다음 paint 뒤 즉시 알린다(origin 이 왕복을 잰다).
    if (ev.command_id && !this.sentAtMs.has(ev.command_id) && r.state.phase === 'READY') this.schedulePaintAck(ev.command_id);
  }

  private schedulePaintAck(commandId: string): void {
    const fire = (): void => this.markRendered([commandId]);
    // React 가 이 상태를 commit 한 뒤(다음 frame)에 보낸다. rAF 가 없는 환경(시험·백그라운드)은 timeout 으로 대체.
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      requestAnimationFrame(() => requestAnimationFrame(fire));
    } else {
      setTimeout(fire, 16);
    }
  }

  private scheduleApplied(): void {
    if (this.appliedTimer) return;
    this.appliedTimer = setTimeout(() => {
      this.appliedTimer = null;
      if (this.state.phase !== 'READY') return;
      this.o.socket.emit('live:applied', {
        protocol_version: 2, schema_version: 1, session_id: this.o.sessionId, cursors: this.cursorList(),
      });
    }, APPLIED_BATCH_MS);
  }

  private onHeartbeat(hb: HeartbeatMessage): void {
    const r = applyHeartbeat(this.state, hb);
    this.set(pruneIntents(r.state, this.now()));
    this.run(r.effects);
    if (this.state.phase === 'READY') this.armHeartbeatWatchdog();
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private armHeartbeatWatchdog(): void {
    if (this.hbTimer) clearTimeout(this.hbTimer);
    this.hbTimer = setTimeout(() => {
      this.hbTimer = null;
      if (this.state.phase === 'READY') this.degrade();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private startPresence(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = setInterval(() => {
      if (this.state.phase !== 'READY' || !this.o.socket.connected) return;
      this.o.socket.emit('live:presence', {
        protocol_version: 2,
        schema_version: 1,
        session_id: this.o.sessionId,
        instance_id: this.o.clientInstanceId,
        lease_generation: String(this.generation),
        visibility: typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'background' : 'foreground',
      });
    }, PRESENCE_MS);
  }

  private onTransportDown(): void {
    this.degrade();
  }

  private degrade(): void {
    if (this.terminalOrRevoked()) return;
    this.set(markDegraded(this.state));
    this.startPolling();
  }

  private onRevoked(code: string): void {
    this.set(applyRevoked(this.state, code));
    this.clearTimers();
    this.pending.forEach((p) => { if (p.timer) clearTimeout(p.timer); });
    this.pending.clear();
    this.resolveAllWaiters(code);
  }

  private onTerminal(): void {
    this.set(applyTerminal(this.state));
    this.clearTimers();
  }

  // ── REST 폴백 ───────────────────────────────────────────────
  private startPolling(): void {
    if (this.pollTimer || this.terminalOrRevoked()) return;
    this.pollCount = 0;
    this.schedulePoll(REST_FIRST_DELAY_MS);
  }

  private schedulePoll(delay: number): void {
    this.pollTimer = setTimeout(() => { this.pollTimer = null; void this.poll(); }, delay);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollTicket += 1; // 진행 중이던 GET 응답은 폐기된다
  }

  private async poll(): Promise<void> {
    if (this.terminalOrRevoked() || this.state.phase === 'READY') return;
    const ticket = ++this.pollTicket;
    const requestId = this.o.uuid();
    const generation = String(this.generation);
    // phase 는 DEGRADED 를 유지한 채 이 요청만 기대값으로 고정한다.
    this.set({ ...this.state, expected: { requestId, generation } });
    try {
      const snap = await this.rest.getSnapshot({ sessionId: this.o.sessionId, requestId, generation });
      if (ticket !== this.pollTicket) return; // 더 새로운 세대가 시작됨 → 폐기
      const r = applyRestSnapshot(this.state, snap);
      if (r.applied) { this.set(r.state); this.run(r.effects); this.armHeartbeatWatchdog(); }
    } catch {
      // 폴백 실패는 가짜 값을 만들지 않고 다음 주기에 재시도한다.
    }
    if (ticket !== this.pollTicket || this.isReady() || this.terminalOrRevoked()) return;
    this.pollCount += 1;
    this.schedulePoll(REST_MAX_INTERVAL_MS);
  }

  // ── 명령 ───────────────────────────────────────────────────
  /** 손 들기/내리기 — toggle 없이 raised 를 명시. 낙관 표시는 intent 로만. */
  setHand(raised: boolean): string {
    const self = this.o.selfParticipantId;
    const id = this.sendCommand('hand.set', { raised });
    if (self) {
      this.set(addIntent(this.state, { commandId: id, key: `hand:${self}`, value: raised, issuedAtMs: this.now() }));
    }
    return id;
  }

  /** 모든 명령에 command_id 를 부여한다. 반환값이 그 ID. */
  sendCommand(
    kind: CommandKind,
    payload: Record<string, unknown>,
    opts: { targetId?: string; expectedEntityVersion?: string } = {},
  ): string {
    return this.sendCommandWith(kind, payload, opts);
  }

  private sendCommandWith(
    kind: CommandKind,
    payload: Record<string, unknown>,
    opts: { targetId?: string; expectedEntityVersion?: string },
    beforeTransmit?: (commandId: string) => void,
  ): string {
    const cmd: LiveCommand = {
      protocol_version: 2,
      schema_version: 1,
      command_id: this.o.uuid(),
      session_id: this.o.sessionId,
      expected_epoch: this.state.epoch ?? '0',
      kind,
      client_generation: String(this.generation),
      payload,
      ...(opts.targetId ? { target_id: opts.targetId } : {}),
      ...(opts.expectedEntityVersion ? { expected_entity_version: opts.expectedEntityVersion } : {}),
    };
    this.pending.set(cmd.command_id, { cmd, attempts: 0, timer: null });
    this.sentAtMs.set(cmd.command_id, this.now());
    if (this.sentAtMs.size > 200) this.sentAtMs.delete(this.sentAtMs.keys().next().value as string);
    beforeTransmit?.(cmd.command_id);
    this.transmit(cmd.command_id);
    return cmd.command_id;
  }

  /** 명령을 보내고 최종 ACK(applied/duplicate/rejected, timeout 포함)로 resolve 한다. 예외를 던지지 않는다. */
  request(kind: CommandKind, payload: Record<string, unknown>, opts: { targetId?: string; expectedEntityVersion?: string } = {}): Promise<CommandAck> {
    return new Promise<CommandAck>((resolve) => {
      // 전송 전에 대기자를 등록해 같은 tick 의 즉시 ACK 를 놓치지 않는다.
      this.sendCommandWith(kind, payload, opts, (cid) => {
        this.waiters.set(cid, [...(this.waiters.get(cid) ?? []), resolve]);
      });
    });
  }

  /** 측정 envelope(live:metric) 송신. READY·연결 중에만 보내고, 아니면 false(조용히 버리지 않고 호출자가 판단). */
  sendMetric(envelope: Record<string, unknown>): boolean {
    if (this.state.phase !== 'READY' || !this.o.socket.connected) return false;
    this.o.socket.emit('live:metric', { protocol_version: 2, schema_version: 1, ...envelope });
    return true;
  }

  /** NTP 식 왕복: RTT = (t1-t0) - (server_send - server_receive), offset = ((recv-t0)+(send-t1))/2 */
  clockProbe(monotonicUs: () => number): Promise<{ probeId: string; rttMs: number; offsetMs: number; serverReceiveMs: number; serverSendMs: number } | null> {
    return new Promise((resolve) => {
      if (!this.o.socket.connected) { resolve(null); return; }
      const probeId = this.o.uuid();
      const t0 = this.now();
      this.o.socket.emit('live:clock_probe', { protocol_version: 2, schema_version: 1, probe_id: probeId, client_monotonic_us: String(Math.round(monotonicUs())) }, (res) => {
        const r = res as { ok?: boolean; probe_id?: string; server_receive_ms?: number; server_send_ms?: number } | undefined;
        if (!r || r.ok === false || r.probe_id !== probeId || typeof r.server_receive_ms !== 'number' || typeof r.server_send_ms !== 'number') { resolve(null); return; }
        const t1 = this.now();
        resolve({
          probeId,
          rttMs: (t1 - t0) - (r.server_send_ms - r.server_receive_ms),
          offsetMs: ((r.server_receive_ms - t0) + (r.server_send_ms - t1)) / 2,
          serverReceiveMs: r.server_receive_ms,
          serverSendMs: r.server_send_ms,
        });
      });
    });
  }

  /** 화면에 그린 뒤(다음 paint) 호출 — 상대 발신자에게 live:rendered 가 가도록 즉시 applied 를 보낸다(1초 배치 아님). */
  markRendered(commandIds: string[]): void {
    if (commandIds.length === 0 || !this.o.socket.connected || this.state.phase !== 'READY') return;
    this.o.socket.emit('live:applied', {
      protocol_version: 2, schema_version: 1, session_id: this.o.sessionId,
      cursors: this.cursorList(), rendered_command_ids: commandIds.slice(0, 100),
    });
  }

  /** 상대가 내 명령을 그렸다는 live:rendered 수신 — 입력→수신 monotonic 차이(왕복)를 알린다. */
  onRendered(fn: (m: { commandId: string; rttMs: number }) => void): () => void {
    this.renderedListeners.add(fn);
    return () => { this.renderedListeners.delete(fn); };
  }

  private onRenderedMsg(m: { command_id?: string }): void {
    const id = m.command_id;
    if (!id) return;
    const at = this.sentAtMs.get(id);
    if (at === undefined) return; // 모르는/중복 delivery 는 무시
    this.sentAtMs.delete(id);
    const rttMs = this.now() - at;
    for (const fn of this.renderedListeners) fn({ commandId: id, rttMs });
  }

  private transmit(commandId: string): void {
    const p = this.pending.get(commandId);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    p.attempts += 1;
    const viaRest = this.state.phase === 'DEGRADED' || !this.o.socket.connected;
    if (viaRest) {
      this.rest.postCommand(p.cmd).then((ack) => this.handleAck(ack)).catch(() => { /* timeout 타이머가 재시도 */ });
    } else {
      this.o.socket.emit('live:command', p.cmd, (res) => {
        const ack = res as CommandAck | undefined;
        if (ack && typeof ack === 'object' && 'status' in ack) this.handleAck(ack);
      });
    }
    p.timer = setTimeout(() => this.onCommandTimeout(commandId), COMMAND_TIMEOUT_MS);
  }

  private onCommandTimeout(commandId: string): void {
    const p = this.pending.get(commandId);
    if (!p) return;
    const idx = p.attempts - 1;
    if (idx >= RETRY_BACKOFF_MS.length) {
      this.pending.delete(commandId);
      const timeoutAck: CommandAck = { command_id: commandId, status: 'rejected', epoch: this.state.epoch ?? '0', cursors: [], committed: false, code: 'timeout' };
      this.set(resolveIntent(this.state, timeoutAck));
      this.settle(timeoutAck);
      this.resync('command_timeout');
      return;
    }
    p.timer = setTimeout(() => this.transmit(commandId), RETRY_BACKOFF_MS[idx]);
  }

  private handleAck(ack: CommandAck): void {
    const p = this.pending.get(ack.command_id);
    if (p?.timer) clearTimeout(p.timer);
    if (ack.status === 'retryable') {
      if (p) p.timer = setTimeout(() => this.transmit(ack.command_id), ack.retry_after_ms ?? RETRY_BACKOFF_MS[Math.min(p.attempts - 1, RETRY_BACKOFF_MS.length - 1)]);
      this.set(resolveIntent(this.state, ack));
      return;
    }
    this.pending.delete(ack.command_id);
    this.set(resolveIntent(this.state, ack));
    this.settle(ack);
    // 현재 epoch 와 다른 ACK 는 상태를 덮지 않고 새 snapshot 으로 맞춘다.
    if (this.state.epoch !== null && ack.epoch !== this.state.epoch) this.resync('epoch_changed');
  }

  private stopTimers(): void {
    if (this.hbTimer) clearTimeout(this.hbTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    if (this.appliedTimer) clearTimeout(this.appliedTimer);
    this.hbTimer = this.pollTimer = this.appliedTimer = null;
    this.presenceTimer = null;
  }

  private clearTimers(): void {
    this.pollTicket += 1;
    this.stopTimers();
  }
}
