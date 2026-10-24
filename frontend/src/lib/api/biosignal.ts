/** T04~T06 wrapper 매핑의 단일 경계. 객체 내부 G1 UUID/alias 의미는 바꾸지 않는다. */
import { apiClient } from './client';
import type { RawHeader, Signal } from '../biosignal/raw-types';
export type ArtifactKind = 'feature' | 'raw_derived' | 'indices' | 'normalization' | 'algorithm';
export interface ArtifactMeta {
  artifact_alias: string; feature_id_aliases?: string[]; artifact_kind: ArtifactKind;
  stream_id: string | null; segment_id: string | null; signal: Signal | null; view_instance_id?: string | null;
  sequence: number; first_sequence?: number | null; last_sequence?: number | null; row_count: number;
  content_encoding?: 'identity' | 'gzip'; schema_version: string; checksum: string; uncompressed_sha256?: string | null;
  size_bytes: number; time_range?: { from_us: string; to_us: string } | null; content_type?: string;
}
export interface RawMeta { chunk_alias: string; header: RawHeader; checksum: string; size_bytes: number; content_type?: string }
export interface UploadTicket {
  chunk_id?: string; chunk_alias?: string; artifact_id?: string; artifact_alias?: string;
  checksum: string; size_bytes: number; upload_url: string | null; upload_headers: Record<string, string>;
  upload_status: 'pending' | 'uploaded' | 'failed';
}
export interface VerifiedAck extends Omit<UploadTicket, 'upload_url' | 'upload_headers'> {
  verified_at_us: string | null; failure_reason: string | null;
}
export interface ExpectedArtifact { kind: 'raw' | ArtifactKind; alias: string; sha256: string }
export interface StreamClose { stream_id: string; segment_id: string; signal: Signal; last_chunk_sequence: number | null; last_feature_sequence: number | null; received_samples: number }
export interface ViewClose { stream_id: string; view_instance_id: string; last_snapshot_sequence: number | null }
export interface GapEvent {
  event_type: 'gap'; event_id: string; sequence: number; discovered_at_us: string; signal: Signal;
  stream_id: string; segment_id: string; start_us: string; end_us: string | null;
  reason: 'ble_disconnect' | 'packet_gap' | 'local_write_failed' | 'process_terminated' | 'clock_reset' | 'wall_clock_jump' | 'reanchor' | 'unknown' | 'upload_pending' | 'not_rendered';
  observed_or_estimated: 'observed' | 'estimated' | 'unknown'; expected_samples: number | null; received_samples: number | null; reconnect_count: number;
}
export interface LostArtifact { kind: 'raw' | ArtifactKind; alias: string; reason: string }
export interface CloseIntent {
  event_type: 'close_intent'; intent_id: string; expected_artifacts: ExpectedArtifact[]; streams: StreamClose[];
  lost_artifacts?: LostArtifact[];
  snapshots: ViewClose[]; last_gap_sequence: number | null; end_reason: string; closed_at_us: string;
}
export interface EventsResult {
  events: { event_type: string; event_id: string; status: 'recorded' | 'duplicate' | 'conflict' }[];
  manifest_revision: number | null; close_state: 'pending_upload' | 'partial' | 'complete' | 'unknown' | null; missing_artifacts: ExpectedArtifact[];
}
export interface Capability {
  raw_schemas: string[]; signals: { signal: Signal; upload_allowed: boolean; reason: string | null }[];
  artifact_kinds: ArtifactKind[]; events: boolean; upload_immutability: string;
}
export interface BiosignalTransport {
  get<T>(path: string, options?: { skipAuth?: boolean; headers?: Record<string, string> }): Promise<T>;
  post<T>(path: string, body: unknown, options?: { skipAuth?: boolean; headers?: Record<string, string> }): Promise<T>;
}
export function createBiosignalApi(auth: { entryCredential?: string | null; skipAuth?: boolean }, transport: BiosignalTransport = apiClient) {
  const options = auth.entryCredential ? { skipAuth: true, headers: { 'X-Entry-Credential': auth.entryCredential } } : { skipAuth: auth.skipAuth ?? false };
  const path = (session: string, suffix: string) => `/sessions/${encodeURIComponent(session)}/${suffix}`;
  return {
    capability: (session: string, participant: string | null) => transport.get<Capability>(path(session, `biosignal-capabilities${participant ? `?participant_id=${encodeURIComponent(participant)}` : ''}`), options),
    presign: async (session: string, participant: string | null, kind: 'raw' | ArtifactKind, meta: RawMeta | ArtifactMeta, playGroup?: string | null) => {
      const response = await transport.post<{ chunks: UploadTicket[] }>(path(session, kind === 'raw' ? 'biosignal-raw/presign' : 'biosignal-artifacts/presign'), { participant_id: participant, play_group_id: playGroup ?? null, chunks: [meta] }, options);
      return response.chunks[0];
    },
    ack: async (session: string, participant: string | null, kind: 'raw' | ArtifactKind, id: string, checksum: string, size: number) => {
      const response = await transport.post<{ chunks: VerifiedAck[] }>(path(session, kind === 'raw' ? 'biosignal-raw/ack' : 'biosignal-artifacts/ack'), { participant_id: participant, chunks: [{ [kind === 'raw' ? 'chunk_id' : 'artifact_id']: id, checksum, size_bytes: size }] }, options);
      return response.chunks.find(item => (kind === 'raw' ? item.chunk_id : item.artifact_id) === id);
    },
    events: (session: string, participant: string | null, events: (GapEvent | CloseIntent)[]) => transport.post<EventsResult>(path(session, 'biosignal-events'), { participant_id: participant, events }, options),
  };
}
export type BiosignalApi = ReturnType<typeof createBiosignalApi>;
