/** G1 biosignal.py RawHeader/PacketMap의 웹 소비 타입. 계약은 서버가 소유한다. */
export type Signal = 'eeg' | 'ppg' | 'acc';
export interface Rate { numerator: number; denominator: number }
export interface ParserProfile {
  firmware: string; device_model: string; profile_id: string; version: string;
  parameters_hash: string; platform: 'mb-web' | 'mb-app-js' | 'native-candidate' | 'synthetic';
  verification: 'unverified' | 'synthetic_only' | 'device_verified';
  packet_endian: 'little' | 'big' | 'mixed' | 'unknown'; tick_hz: number; tick_bits: number;
  header_anchor: 'first_sample' | 'last_sample' | 'unknown';
}
export interface RawAnchor {
  sample_index: number; utc_us: string | null; monotonic_us: string; relative_us: string;
  device_tick_raw: string | null; device_tick_unwrapped: string | null;
  clock_segment_id: string; uncertainty_us: number | null; rule: 'anchor_plus_index_delta_over_rate';
}
export interface RawSection {
  name: 'samples' | 'packets' | 'packet_map'; offset: number; length: number; row_stride: number;
  encoding: 'eeg-i32-i32-u8-f32-f32-le' | 'ppg-u32-u32-le' | 'acc-i16-i16-i16-f32-f32-f32-le' | 'bytes' | 'utf8-jsonl';
}
export interface RawHeader {
  schema_version: 'mb-biosignal-raw-v2'; signal_type: Signal; stream_id: string; segment_id: string;
  chunk_index: number; parser_profile: ParserProfile; rate: Rate; observed_rate: Rate | null;
  observed_rate_window_us: number | null; observed_rate_reason: string | null;
  channels: string[]; units: string[]; scale: number[]; sample_count: number; packet_count: number;
  first_sample_index: number; end_sample_index_exclusive: number;
  time_basis: 'host_estimated' | 'device_relative' | 'utc_verified' | 'session_relative';
  anchor: RawAnchor; sections: RawSection[];
}
export interface PacketMap {
  packet_seq: number; byte_offset: number; byte_length: number; first_sample_index: number | null;
  sample_count: number; tick_raw: string | null; tick_unwrapped: string | null;
  received_utc_us: string | null; received_monotonic_us: string;
  header_anchor: 'first_sample' | 'last_sample' | 'unknown'; clock_segment_id: string;
  malformed_reason: string | null;
}
export interface RawPacket {
  signal: Signal; bytes: Uint8Array; rows: number[][]; tickRaw: number | null;
  malformedReason: string | null; receivedUtcUs: string; receivedMonotonicUs: string;
}
export interface MappedPacket { bytes: Uint8Array; map: PacketMap }
