// SDD-246 T06 — session-live v2 wire 타입(contracts/session-live-v2 의 TS 거울).
// 64비트 seq/version/epoch 는 십진 문자열(JS 안전 정수 경계 회피). 비교는 compareU64 로만 한다.

export type U64 = string;
export type Domain =
  | 'session' | 'participation' | 'waiting' | 'speaking' | 'signal'
  | 'audio' | 'device' | 'metrics' | 'aggregate' | 'policy';

export interface Cursor { audience: string; domain: string; seq: U64 }

export type Validity = 'valid' | 'warming_up' | 'invalid' | 'gap';
export interface MetricValue {
  value: number | null;
  unit: string;
  validity: Validity;
  reason: string | null;
  last_valid_sequence: U64 | null;
  last_valid_observed_at_ms: number | null;
}
export type MetricSet = Record<string, MetricValue>;
export type Contact = { fp1: string; fp2: string };
export type EntityFreshness = 'fresh' | 'delayed' | 'stale' | 'time_uncertain';

export interface MetricsEntityData {
  participant_id: string;
  stream_id: string;
  sequence: U64;
  observed_at_ms: number | null;
  freshness: EntityFreshness;
  sqi: number | null;
  contact: Contact;
  metrics: MetricSet;
}
export interface SessionData {
  phase: 'scheduled' | 'open' | 'waiting' | 'in_progress' | 'ended' | 'cancelled';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  started_at_ms: number | null;
  ended_at_ms: number | null;
  cutoff_ms: number | null;
}
export interface ParticipationData {
  participant_id: string;
  role: 'host' | 'member';
  attendance: 'none' | 'waiting' | 'attending' | 'left' | 'removed';
  connected: boolean;
}
export interface WaitingData { participant_id: string; ready: boolean; checkin_revision: U64; waitlist_position: number | null }
export interface SpeakingData { participant_id: string; hand_raised: boolean; can_publish: boolean; grant_version: U64 }
export interface SignalData { signal_id: string; participant_id: string; signal_type: 'following' | 'difficult' | 'resting'; expires_at_ms: number }
export interface AudioData { track_id: string | null; action: 'play' | 'pause' | 'seek' | 'stop'; position_ms: number; server_anchor_ms: number; rate: number; revision: U64 }
export interface DeviceData {
  participant_id: string; stream_id: string; device_seq: U64;
  band_state: 'not_worn' | 'connecting' | 'connected' | 'reconnecting' | 'lost' | 'unknown';
  contact: Contact; sqi: number | null; battery_pct: number | null; state_reason: string | null;
}
export interface AggregateMetric { mean: number | null; valid_count: number }
export interface AggregateData { revision: U64; window_ms: number; participant_count: number; metrics: Record<string, AggregateMetric> }
export interface PolicyData { chat_enabled: boolean; capabilities: string[]; consent_revision: U64 }
export interface Tombstone { entity_id: string; version: U64 }

export interface Versioned<T> { version: U64; data: T }
export interface EntityDomain<T> { entities: Record<string, Versioned<T>>; tombstones: Tombstone[] }

export interface LiveSnapshot {
  protocol_version: 2;
  schema_version: 1;
  snapshot_id: string;
  request_id: string;
  connection_generation: U64;
  session_id: string;
  epoch: U64;
  audiences: string[];
  through: Cursor[];
  server_time_ms: number;
  auth_revision: U64;
  session: Versioned<SessionData>;
  participation: EntityDomain<ParticipationData>;
  waiting: EntityDomain<WaitingData>;
  speaking: EntityDomain<SpeakingData>;
  signal: EntityDomain<SignalData>;
  audio: Versioned<AudioData>;
  devices: EntityDomain<DeviceData>;
  metrics: EntityDomain<MetricsEntityData>;
  aggregates: Versioned<AggregateData>;
  policy: Versioned<PolicyData>;
  terminal: boolean;
}

export interface LiveEvent {
  protocol_version: 2;
  schema_version: 1;
  event_id: string;
  session_id: string;
  epoch: U64;
  audience: string;
  domain: Domain;
  seq: U64;
  entity_id: string;
  entity_version: U64;
  kind: string;
  observed_at_ms: number | null;
  received_at_server_ms: number;
  command_id?: string;
  payload: unknown;
}

export interface HeartbeatMessage {
  session_id: string;
  epoch: U64;
  through: Cursor[];
  auth_revision: U64;
  server_time_ms: number;
}

export type CommandKind =
  | 'entry.enter' | 'entry.leave' | 'waiting.set_ready' | 'session.open' | 'session.start'
  | 'session.end' | 'session.cancel' | 'waiting.remind' | 'waitlist.cancel' | 'waitlist.promote'
  | 'hand.set' | 'hand.lower' | 'speaking.set' | 'signal.send' | 'signal.clear'
  | 'audio.set' | 'chat.set_enabled' | 'capture.start' | 'capture.close' | 'capture.renew'
  | 'capture.reanchor';

export interface LiveCommand {
  protocol_version: 2;
  schema_version: 1;
  command_id: string;
  session_id: string;
  expected_epoch: U64;
  kind: CommandKind;
  target_id?: string;
  expected_entity_version?: U64;
  client_generation: U64;
  payload: Record<string, unknown>;
}

export type AckStatus = 'applied' | 'duplicate' | 'rejected' | 'retryable';
export interface CommandAck {
  command_id: string;
  status: AckStatus;
  epoch: U64;
  cursors: Cursor[];
  entity_version?: U64;
  code?: string;
  retry_after_ms?: number;
  committed: boolean;
}

/** 서버 `live:resync_required` · 클라이언트 자체 판정 사유 */
export type ResyncReason =
  | 'seq_gap' | 'heartbeat_ahead' | 'epoch_changed' | 'auth_revision' | 'buffer_overflow'
  | 'version_conflict' | 'server_requested' | 'transport_reconnect' | 'command_timeout';
