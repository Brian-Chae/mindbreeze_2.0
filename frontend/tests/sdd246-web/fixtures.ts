// SDD-246 T06 — 시험 공용 fixture. 계약(contracts/session-live-v2) 형태를 따르는 합성 데이터만 쓴다.
import type { LiveEvent, LiveSnapshot, MetricsEntityData } from '../../src/lib/session-live/live-types';

export const SID = '00000001-0000-4000-8000-000000000001';
export const PID = '00000002-0000-4000-8000-000000000002';
export const STREAM = '00000014-0000-4000-8000-000000000014';

export function metricSet(focus: number | null, observed: number, seq: string): MetricsEntityData['metrics'] {
  const m = (value: number | null, unit: string, validity: 'valid' | 'warming_up' | 'invalid' | 'gap' = 'valid') => ({
    value,
    unit,
    validity: value == null && validity === 'valid' ? ('invalid' as const) : validity,
    reason: value == null ? 'no_data' : null,
    last_valid_sequence: value == null ? null : seq,
    last_valid_observed_at_ms: value == null ? null : observed,
  });
  return {
    focus_display: m(focus, 'score_0_100'),
    relaxation_display: m(55, 'score_0_100'),
    emotion_display: m(50, 'score_0_100'),
    bpm: m(68, 'beats_per_min'),
    respiration: m(null, 'breaths_per_min', 'warming_up'),
    sdnn: m(null, 'ms', 'invalid'),
  };
}

export function metricsData(seq: string, observed: number, focus: number | null = 62): MetricsEntityData {
  return {
    participant_id: PID,
    stream_id: STREAM,
    sequence: seq,
    observed_at_ms: observed,
    freshness: 'fresh',
    sqi: 0.82,
    contact: { fp1: 'contact', fp2: 'contact' },
    metrics: metricSet(focus, observed, seq),
  };
}

export function snapshot(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    protocol_version: 2,
    schema_version: 1,
    snapshot_id: '00000046-0000-4000-8000-000000000046',
    request_id: '00000047-0000-4000-8000-000000000047',
    connection_generation: '7',
    session_id: SID,
    epoch: '1',
    audiences: ['host', 'public'],
    through: [
      { audience: 'host', domain: 'metrics', seq: '41' },
      { audience: 'host', domain: 'speaking', seq: '5' },
      { audience: 'host', domain: 'participation', seq: '2' },
    ],
    server_time_ms: 1_760_000_000_700,
    auth_revision: '4',
    session: { version: '2', data: { phase: 'in_progress', status: 'in_progress', started_at_ms: 1_760_000_000_000, ended_at_ms: null, cutoff_ms: null } },
    participation: { entities: { [PID]: { version: '3', data: { participant_id: PID, role: 'member', attendance: 'attending', connected: true } } }, tombstones: [] },
    waiting: { entities: {}, tombstones: [] },
    speaking: { entities: { [PID]: { version: '3', data: { participant_id: PID, hand_raised: true, can_publish: false, grant_version: '1' } } }, tombstones: [] },
    signal: { entities: {}, tombstones: [] },
    audio: { version: '9', data: { track_id: null, action: 'stop', position_ms: 0, server_anchor_ms: 1_760_000_000_000, rate: 1, revision: '9' } },
    devices: { entities: {}, tombstones: [] },
    metrics: { entities: { [PID]: { version: '3', data: metricsData('41', 1_760_000_000_000, 60) } }, tombstones: [] },
    aggregates: { version: '0', data: { revision: '0', window_ms: 5000, participant_count: 0, metrics: {} } },
    policy: { version: '2', data: { chat_enabled: true, capabilities: ['raise_hand'], consent_revision: '2' } },
    terminal: false,
    ...over,
  } as LiveSnapshot;
}

export function event(
  domain: LiveEvent['domain'],
  kind: string,
  seq: string,
  entityVersion: string,
  payload: unknown,
  audience = 'host',
  entityId = PID,
): LiveEvent {
  return {
    protocol_version: 2,
    schema_version: 1,
    event_id: `0000003c-0000-4000-8000-${seq.padStart(12, '0')}`,
    session_id: SID,
    epoch: '1',
    audience,
    domain,
    seq,
    entity_id: entityId,
    entity_version: entityVersion,
    kind,
    observed_at_ms: null,
    received_at_server_ms: 1_760_000_000_900,
    payload,
  } as LiveEvent;
}

/** 현행 v1 `participant_changed` 의 rich 객체(감사 보고서 B1) — 측정/손 필드를 null·과거 값으로 들고 있다. */
export const RICH_LEGACY_PARTICIPANT = {
  participant_id: PID,
  member_id: 'm-1',
  canonical_member_id: 'm-1',
  attendance_status: 'attended',
  entered_at: '2026-10-26T00:00:00Z',
  checkin_state: 'completed',
  checkin_at: '2026-10-26T00:00:00Z',
  presence_state: 'connected',
  presence_expires_at: null,
  device_status: null,
  current_efficiency: null,
  last_eeg_at: null,
  raise_hand: true,
  speaking: false,
} as const;
