// SDD-246 T06 — LiveState 단일 reducer.
// 규칙: 화면 상태는 (1) 완전 snapshot (2) domain seq 가 이어지는 이벤트로만 바뀐다.
//  - 폴링·늦은 GET·rich participant 객체는 이 reducer 를 통하지 않고는 상태에 닿지 못한다.
//  - 같은 (domain, entity) 는 entity_version 이 낮은 쪽을 폐기한다(audience 가 달라도 공통 비교).
//  - 낙관적 intent(손들기 등)는 상태와 분리해 `intents` 에만 둔다. 상태를 직접 바꾸지 않는다.
// 순수 함수만 둔다(부수효과는 effects 로 반환 → live-client 가 실행).
import type {
  AggregateData, AudioData, CommandAck, Cursor, DeviceData, Domain, EntityDomain, HeartbeatMessage,
  LiveEvent, LiveSnapshot, MetricsEntityData, ParticipationData, PolicyData, ResyncReason,
  SessionData, SignalData, SpeakingData, U64, Versioned, WaitingData,
} from './live-types';

export type LivePhase = 'CONNECTING' | 'RESYNCING' | 'READY' | 'DEGRADED' | 'TERMINAL' | 'REVOKED';

export type LiveEffect =
  | { type: 'resync'; reason: ResyncReason }
  | { type: 'send_applied'; snapshotId: string }
  | { type: 'stop_polling' };

export const INTENT_TTL_MS = 30_000;
export const EVENT_BUFFER_LIMIT = 1000;

export interface Intent {
  commandId: string;
  /** `hand:<participant_id>` 처럼 대상 단위 키 — 같은 키의 새 intent 가 옛 intent 를 대체한다 */
  key: string;
  value: boolean;
  issuedAtMs: number;
}

type EntityMap<T> = Record<string, Versioned<T>>;

export interface LiveState {
  sessionId: string;
  phase: LivePhase;
  epoch: U64 | null;
  authRevision: U64 | null;
  snapshotId: string | null;
  /** 가장 최근에 요청한 snapshot — 이 request_id/generation 이 아닌 응답은 폐기한다 */
  expected: { requestId: string; generation: U64 } | null;
  cursors: Record<string, U64>;
  session: Versioned<SessionData> | null;
  audio: Versioned<AudioData> | null;
  aggregates: Versioned<AggregateData> | null;
  policy: Versioned<PolicyData> | null;
  participation: EntityMap<ParticipationData>;
  waiting: EntityMap<WaitingData>;
  speaking: EntityMap<SpeakingData>;
  signal: EntityMap<SignalData>;
  devices: EntityMap<DeviceData>;
  metrics: EntityMap<MetricsEntityData>;
  /** tombstone — 같은 version 이하의 되살림 이벤트를 막는다 */
  removed: Record<string, U64>;
  /** snapshot 전에 도착한 이벤트(상한 1000) */
  buffer: LiveEvent[];
  intents: Record<string, Intent>;
  revokedCode: string | null;
}

export interface Result {
  state: LiveState;
  effects: LiveEffect[];
}

export const compareU64 = (a: U64, b: U64): number => {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

export const cursorKey = (audience: string, domain: string): string => `${audience}|${domain}`;

export function createLiveState(init: { sessionId: string }): LiveState {
  return {
    sessionId: init.sessionId,
    phase: 'CONNECTING',
    epoch: null,
    authRevision: null,
    snapshotId: null,
    expected: null,
    cursors: {},
    session: null,
    audio: null,
    aggregates: null,
    policy: null,
    participation: {},
    waiting: {},
    speaking: {},
    signal: {},
    devices: {},
    metrics: {},
    removed: {},
    buffer: [],
    intents: {},
    revokedCode: null,
  };
}

/** snapshot 요청 시작 — request_id/generation 을 고정하고 RESYNCING 으로 */
export function beginResync(state: LiveState, expected: { requestId: string; generation: U64 }): LiveState {
  if (state.phase === 'TERMINAL' || state.phase === 'REVOKED') return state;
  return { ...state, phase: 'RESYNCING', expected };
}

const DOMAIN_FIELD = {
  participation: 'participation',
  waiting: 'waiting',
  speaking: 'speaking',
  signal: 'signal',
  device: 'devices',
  metrics: 'metrics',
} as const;
type EntityDomainName = keyof typeof DOMAIN_FIELD;

function cursorsFrom(through: Cursor[]): Record<string, U64> {
  const out: Record<string, U64> = {};
  for (const c of through) out[cursorKey(c.audience, c.domain)] = c.seq;
  return out;
}

function entitiesFrom<T>(domain: EntityDomain<T>): { entities: EntityMap<T>; removed: Record<string, U64> } {
  const removed: Record<string, U64> = {};
  for (const t of domain.tombstones) removed[t.entity_id] = t.version;
  return { entities: { ...domain.entities }, removed };
}

function stateFromSnapshot(base: LiveState, snap: LiveSnapshot): LiveState {
  const removed: Record<string, U64> = {};
  const part = entitiesFrom(snap.participation);
  const wait = entitiesFrom(snap.waiting);
  const spk = entitiesFrom(snap.speaking);
  const sig = entitiesFrom(snap.signal);
  const dev = entitiesFrom(snap.devices);
  const met = entitiesFrom(snap.metrics);
  for (const r of [part, wait, spk, sig, dev, met]) Object.assign(removed, r.removed);
  return {
    ...base,
    phase: snap.terminal ? 'TERMINAL' : 'READY',
    epoch: snap.epoch,
    authRevision: snap.auth_revision,
    snapshotId: snap.snapshot_id,
    cursors: cursorsFrom(snap.through),
    session: snap.session,
    audio: snap.audio,
    aggregates: snap.aggregates,
    policy: snap.policy,
    participation: part.entities,
    waiting: wait.entities,
    speaking: spk.entities,
    signal: sig.entities,
    devices: dev.entities,
    metrics: met.entities,
    removed,
    buffer: [],
  };
}

/**
 * 완전 snapshot 적용. 요청한 request_id/generation 이 아니거나 session 이 다르면 폐기(늦은 응답 방어).
 * 적용 후 snapshot 전에 버퍼된 delta 를 through 이후부터 이어 적용한다.
 */
export function applySnapshot(state: LiveState, snap: LiveSnapshot): Result & { applied: boolean } {
  if (state.phase === 'TERMINAL' || state.phase === 'REVOKED') return { state, effects: [], applied: false };
  if (snap.session_id !== state.sessionId) return { state, effects: [], applied: false };
  if (!state.expected || snap.request_id !== state.expected.requestId || snap.connection_generation !== state.expected.generation) {
    return { state, effects: [], applied: false };
  }
  let next = stateFromSnapshot(state, snap);
  const effects: LiveEffect[] = [{ type: 'send_applied', snapshotId: snap.snapshot_id }, { type: 'stop_polling' }];
  const queue = [...state.buffer].sort((a, b) => compareU64(a.seq, b.seq));
  for (const ev of queue) {
    if (next.phase !== 'READY') break;
    const r = applyEvent(next, ev);
    next = r.state;
    effects.push(...r.effects);
  }
  return { state: { ...next, expected: null }, effects, applied: true };
}

/**
 * 장애 폴백(REST) snapshot. READY 에서는 폴링이 없으므로 항상 폐기.
 * DEGRADED/RESYNCING 에서도 현재 cursor 보다 과거인 snapshot 은 폐기한다(늦은 GET 방어).
 */
export function applyRestSnapshot(state: LiveState, snap: LiveSnapshot): Result & { applied: boolean } {
  if (state.phase === 'READY' || state.phase === 'TERMINAL' || state.phase === 'REVOKED') {
    return { state, effects: [], applied: false };
  }
  if (state.epoch !== null && snap.epoch === state.epoch) {
    const incoming = cursorsFrom(snap.through);
    for (const [key, seq] of Object.entries(state.cursors)) {
      const inSeq = incoming[key];
      if (inSeq !== undefined && compareU64(inSeq, seq) < 0) return { state, effects: [], applied: false };
    }
  }
  return applySnapshot(state, snap);
}

function dropOrApplyEntity<T>(
  map: EntityMap<T>,
  removed: Record<string, U64>,
  id: string,
  version: U64,
  data: T,
): { map: EntityMap<T>; applied: boolean } {
  const tomb = removed[id];
  if (tomb !== undefined && compareU64(version, tomb) <= 0) return { map, applied: false };
  const cur = map[id];
  if (cur && compareU64(version, cur.version) < 0) return { map, applied: false };
  return { map: { ...map, [id]: { version, data } }, applied: true };
}

function isEntityDomain(d: Domain): d is EntityDomainName {
  return d in DOMAIN_FIELD;
}

function applyPayload(state: LiveState, ev: LiveEvent): LiveState {
  const v = ev.entity_version;
  switch (ev.kind) {
    case 'session.changed':
      if (state.session && compareU64(v, state.session.version) < 0) return state;
      return { ...state, session: { version: v, data: ev.payload as SessionData } };
    case 'audio.changed':
      if (state.audio && compareU64(v, state.audio.version) < 0) return state;
      return { ...state, audio: { version: v, data: ev.payload as AudioData } };
    case 'aggregate.updated':
      if (state.aggregates && compareU64(v, state.aggregates.version) < 0) return state;
      return { ...state, aggregates: { version: v, data: ev.payload as AggregateData } };
    case 'policy.changed':
      if (state.policy && compareU64(v, state.policy.version) < 0) return state;
      return { ...state, policy: { version: v, data: ev.payload as PolicyData } };
    case 'participant.changed': {
      const r = dropOrApplyEntity(state.participation, state.removed, ev.entity_id, v, ev.payload as ParticipationData);
      return r.applied ? { ...state, participation: r.map } : state;
    }
    case 'waiting.changed': {
      const r = dropOrApplyEntity(state.waiting, state.removed, ev.entity_id, v, ev.payload as WaitingData);
      return r.applied ? { ...state, waiting: r.map } : state;
    }
    case 'speaking.changed': {
      const r = dropOrApplyEntity(state.speaking, state.removed, ev.entity_id, v, ev.payload as SpeakingData);
      return r.applied ? { ...state, speaking: r.map } : state;
    }
    case 'signal.changed': {
      const r = dropOrApplyEntity(state.signal, state.removed, ev.entity_id, v, ev.payload as SignalData);
      return r.applied ? { ...state, signal: r.map } : state;
    }
    case 'device.changed': {
      const r = dropOrApplyEntity(state.devices, state.removed, ev.entity_id, v, ev.payload as DeviceData);
      return r.applied ? { ...state, devices: r.map } : state;
    }
    case 'metrics.updated': {
      const incoming = ev.payload as MetricsEntityData;
      const cur = state.metrics[ev.entity_id];
      // 같은 stream 안에서는 sequence 가 앞서야 한다 — 늦은 backlog 가 최신 관측으로 부활하지 못한다.
      if (cur && cur.data.stream_id === incoming.stream_id && compareU64(incoming.sequence, cur.data.sequence) <= 0) return state;
      const r = dropOrApplyEntity(state.metrics, state.removed, ev.entity_id, v, incoming);
      return r.applied ? { ...state, metrics: r.map } : state;
    }
    case 'participant.removed':
    case 'signal.expired': {
      const t = ev.payload as { entity_id: string; version: U64 };
      const field = ev.kind === 'signal.expired' ? 'signal' : 'participation';
      const cur = (state[field] as EntityMap<unknown>)[t.entity_id];
      if (cur && compareU64(t.version, cur.version) < 0) return state;
      const copy = { ...(state[field] as EntityMap<unknown>) };
      delete copy[t.entity_id];
      const removedMap = { ...state.removed, [t.entity_id]: t.version };
      if (ev.kind === 'participant.removed') {
        // 제거된 참가자의 파생 상태도 함께 지운다(본인 지표·손 상태가 남아 보이지 않게).
        const spk = { ...state.speaking }; const met = { ...state.metrics }; const dev = { ...state.devices }; const wt = { ...state.waiting };
        delete spk[t.entity_id]; delete met[t.entity_id]; delete dev[t.entity_id]; delete wt[t.entity_id];
        return { ...state, participation: copy as EntityMap<ParticipationData>, speaking: spk, metrics: met, devices: dev, waiting: wt, removed: removedMap };
      }
      return { ...state, signal: copy as EntityMap<SignalData>, removed: removedMap };
    }
    default:
      return state;
  }
}

/** 이벤트 1건 적용. domain seq 가 정확히 +1 일 때만 상태를 바꾼다. */
export function applyEvent(state: LiveState, ev: LiveEvent): Result {
  if (state.phase === 'TERMINAL' || state.phase === 'REVOKED') return { state, effects: [] };
  if (ev.session_id !== state.sessionId) return { state, effects: [] };

  // snapshot 전(또는 재동기화 중): 버퍼에만 쌓는다. 상한 초과는 새 snapshot.
  if (state.phase === 'CONNECTING' || state.phase === 'RESYNCING') {
    if (state.buffer.length >= EVENT_BUFFER_LIMIT) {
      return { state: { ...state, buffer: [] }, effects: [{ type: 'resync', reason: 'buffer_overflow' }] };
    }
    return { state: { ...state, buffer: [...state.buffer, ev] }, effects: [] };
  }
  if (state.epoch !== null && ev.epoch !== state.epoch) {
    return { state: { ...state, phase: 'RESYNCING', buffer: [] }, effects: [{ type: 'resync', reason: 'epoch_changed' }] };
  }

  const key = cursorKey(ev.audience, ev.domain);
  const cur = state.cursors[key];
  if (cur !== undefined) {
    const cmp = compareU64(ev.seq, cur);
    if (cmp <= 0) return { state, effects: [] }; // 중복·과거 → 상태 불변(동일 참조)
    if (compareU64(ev.seq, (BigInt(cur) + 1n).toString()) !== 0) {
      return { state: { ...state, phase: 'RESYNCING', buffer: [] }, effects: [{ type: 'resync', reason: 'seq_gap' }] };
    }
  }
  // cursor 를 아직 모르는 (audience,domain) 의 첫 이벤트는 수용한다(snapshot through 는 변화가 있던 domain 만 담을 수 있음).
  const advanced: LiveState = { ...state, cursors: { ...state.cursors, [key]: ev.seq } };
  const payloadApplied = isEntityDomain(ev.domain) || ev.domain === 'session' || ev.domain === 'audio' || ev.domain === 'aggregate' || ev.domain === 'policy'
    ? applyPayload(advanced, ev)
    : advanced;
  return { state: payloadApplied, effects: [] };
}

/** heartbeat: through 가 우리 cursor 보다 앞서면 이벤트 유실 → resync. 상태는 바꾸지 않는다. */
export function applyHeartbeat(state: LiveState, hb: HeartbeatMessage): Result {
  if (state.phase !== 'READY' || hb.session_id !== state.sessionId) return { state, effects: [] };
  if (state.epoch !== null && hb.epoch !== state.epoch) {
    return { state: { ...state, phase: 'RESYNCING' }, effects: [{ type: 'resync', reason: 'epoch_changed' }] };
  }
  if (state.authRevision !== null && hb.auth_revision !== state.authRevision) {
    return { state: { ...state, phase: 'RESYNCING' }, effects: [{ type: 'resync', reason: 'auth_revision' }] };
  }
  for (const c of hb.through) {
    const mine = state.cursors[cursorKey(c.audience, c.domain)];
    const ahead = mine === undefined ? c.seq !== '0' : compareU64(c.seq, mine) > 0;
    if (ahead) return { state: { ...state, phase: 'RESYNCING' }, effects: [{ type: 'resync', reason: 'heartbeat_ahead' }] };
  }
  return { state, effects: [] };
}

export function applyTerminal(state: LiveState): LiveState {
  return state.phase === 'REVOKED' ? state : { ...state, phase: 'TERMINAL', buffer: [] };
}

/** 권한 회수 — 모든 개인 상태를 비우고 재join 을 중단한다 */
export function applyRevoked(state: LiveState, code: string): LiveState {
  return { ...createLiveState({ sessionId: state.sessionId }), phase: 'REVOKED', revokedCode: code };
}

/** 전송 장애 — DEGRADED(REST 폴백). 이미 받은 값은 그대로 두고 신선도만 시간으로 판정한다. */
export function markDegraded(state: LiveState): LiveState {
  if (state.phase !== 'READY' && state.phase !== 'RESYNCING' && state.phase !== 'CONNECTING') return state;
  return { ...state, phase: 'DEGRADED' };
}

// ── intent(낙관적 표시) ─────────────────────────────────────────

export function addIntent(state: LiveState, intent: Intent): LiveState {
  return { ...state, intents: { ...state.intents, [intent.key]: intent } };
}

/**
 * ACK 처리. 이 command_id 가 해당 key 의 현재 intent 일 때만 정리한다
 * (오래된 실패 ACK 가 새 intent 를 rollback 하지 못한다).
 * applied/duplicate 는 상태가 이벤트로 도착하므로 intent 만 제거, rejected/retryable(미커밋)도 제거=롤백.
 * retryable+committed 는 같은 ID 재시도 대상이라 유지한다.
 */
export function resolveIntent(state: LiveState, ack: CommandAck): LiveState {
  if (ack.status === 'retryable' && ack.committed) return state;
  const entry = Object.values(state.intents).find((i) => i.commandId === ack.command_id);
  if (!entry) return state;
  const intents = { ...state.intents };
  delete intents[entry.key];
  return { ...state, intents };
}

/** TTL 이 지난 intent 정리 */
export function pruneIntents(state: LiveState, nowMs: number): LiveState {
  const keep = Object.entries(state.intents).filter(([, i]) => nowMs - i.issuedAtMs < INTENT_TTL_MS);
  if (keep.length === Object.keys(state.intents).length) return state;
  return { ...state, intents: Object.fromEntries(keep) };
}

export function transportReconnected(state: LiveState): Result {
  if (state.phase === 'TERMINAL' || state.phase === 'REVOKED') return { state, effects: [] };
  return { state: { ...state, phase: 'RESYNCING', buffer: [] }, effects: [{ type: 'resync', reason: 'transport_reconnect' }] };
}
