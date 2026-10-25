// SDD-246 T06 — measurement-bridge 타입(contracts/measurement-bridge/schema/bridge.schema.json 의 TS 거울).
import type { CommandAck, Cursor, LiveCommand, LiveEvent, MetricValue, EntityFreshness, Contact } from '../session-live/live-types';

export type ManagerState = 'IDLE' | 'ARMING' | 'CAPTURING' | 'RECONNECTING' | 'SEALING' | 'DRAINING' | 'CLOSED' | 'BLOCKED';
export type BlockedReason =
  | 'bluetooth_permission' | 'bluetooth_off' | 'storage_full' | 'consent_missing' | 'capture_lease_denied'
  | 'auth_expired' | 'account_mismatch' | 'owner_fenced' | 'unsupported_background';
export type BackgroundSupport = 'supported' | 'unsupported' | 'needs_permission' | 'needs_user_setting';

export interface Capabilities {
  bridge_version: 1;
  platform: 'ios' | 'android' | 'web';
  os_version: string;
  native_runtime_version: string | null;
  core_version: string | null;
  live_protocol_versions: number[];
  device_profiles: string[];
  background: { capture: BackgroundSupport; live_socket: BackgroundSupport; archive_upload: BackgroundSupport };
  permissions: {
    bluetooth: 'granted' | 'denied' | 'not_determined';
    notifications: 'granted' | 'denied' | 'not_determined';
    microphone: 'granted' | 'denied' | 'not_determined' | 'not_required';
  };
}

export interface QueueCounts {
  live_pending: number;
  live_acked: number;
  archive_pending: number;
  archive_verified: number;
  pending_authorization: number;
  pending_time_review: number;
  oldest_pending_age_ms: number | null;
  disk_used_bytes: number;
  disk_limit_bytes: number;
}

export interface Gap {
  gap_id: string;
  kind: 'ble_disconnect' | 'app_killed' | 'os_suspended' | 'storage_full' | 'clock_reset' | 'unknown';
  start_sample_sequence: string;
  end_sample_sequence: string | null;
  bounded: boolean;
}

export interface MetricsSnapshot {
  sequence: string;
  observed_at_ms: number | null;
  freshness: EntityFreshness;
  sqi: number | null;
  contact: Contact;
  metrics: Record<string, MetricValue>;
}

export interface MeasurementSnapshot {
  bridge_version: 1;
  managerGeneration: string;
  seq: string;
  sessionId: string;
  state: ManagerState;
  blocked_reason: BlockedReason | null;
  streamId: string | null;
  ownerGeneration: string | null;
  versions: { native_runtime: string; core: string; algorithm: string; model: string; device_profile: string };
  metrics: MetricsSnapshot | null;
  collection: {
    band_state: 'not_worn' | 'connecting' | 'connected' | 'reconnecting' | 'lost' | 'unknown';
    last_committed_sample_sequence: string | null;
    counters: {
      packets: { eeg: string; ppg: string; acc: string };
      samples: { eeg: string; ppg: string; acc: string };
      native_metric_windows: string;
      native_heartbeat: string;
      js_heartbeat_independent: boolean;
    };
  };
  live: { socket: 'disconnected' | 'connecting' | 'ready' | 'degraded'; last_ack_sequence: string | null; snapshot_through: Cursor[] };
  archive: { queue: QueueCounts; last_verified_at_ms: number | null };
  gaps: Gap[];
}

export interface StartMeasurementRequest {
  sessionId: string;
  credentialHandle: string;
  configHash: string;
  requestId: string;
}
export interface StartMeasurementResult { managerId: string; streamId: string; ownerGeneration: string }
export interface StopMeasurementRequest { reason: string; requestId: string }
export interface DispatchLiveCommandResult { command_id: string; accepted_for_send: boolean; queued_at_native_ms: number }

interface EventBase { bridge_version: 1; managerGeneration: string; seq: string; emitted_at_native_ms: number }
export type BridgeEvent =
  | (EventBase & { event: 'measurementUpdated'; payload: MeasurementSnapshot })
  | (EventBase & { event: 'liveStateUpdated'; payload: { sessionId: string; event: LiveEvent } })
  | (EventBase & { event: 'commandAck'; payload: { sessionId: string; ack: CommandAck } })
  | (EventBase & { event: 'archiveStatus'; payload: { sessionId: string; queue: QueueCounts; blocked_reason: BlockedReason | null; stage: 'presign' | 'put' | 'verify' | null; code: string | null } });

export interface ListenerHandle { remove(): Promise<void> }

/** Capacitor 플러그인 `NativeMeasurement` (iOS/Android 네이티브가 구현) */
export interface NativeMeasurementPlugin {
  getCapabilities(): Promise<Capabilities>;
  startMeasurement(req: StartMeasurementRequest): Promise<StartMeasurementResult>;
  getMeasurementSnapshot(req: { sessionId: string }): Promise<MeasurementSnapshot>;
  dispatchLiveCommand(cmd: LiveCommand): Promise<DispatchLiveCommandResult>;
  stopMeasurement(req: StopMeasurementRequest): Promise<{ accepted: boolean }>;
  addListener(event: BridgeEvent['event'], fn: (e: BridgeEvent) => void): Promise<ListenerHandle>;
}
