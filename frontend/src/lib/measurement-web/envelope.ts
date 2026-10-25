// SDD-246 T06 — 코어 MetricFrame → 서버 MetricEnvelope(plan §3.4). 종합점수 필드는 만들지 않는다.
import type { Contact, MetricSet } from '../session-live/live-types';

export interface CoreMetricFrame {
  sequence: string;
  window_start_us: string;
  window_end_us: string;
  observed_at_ms: number;
  sqi: number | null;
  contact: Contact;
  metrics: MetricSet;
  feature_hash: string;
}

export interface CoreFinalManifest {
  final_sequences: { eeg: string; ppg: string; acc: string; metric: string };
  segments: number;
  raw_sha256: string;
  feature_sha256: string;
}

export interface EnvelopeMeta {
  sessionId: string;
  participantId: string;
  streamId: string;
  streamGeneration: string;
  clockAnchorId: string;
  clockUncertaintyMs: number;
  deviceProfileVersion: string;
  algorithmVersion: string;
  modelVersion: string;
}

export interface MetricEnvelope {
  session_id: string;
  participant_id: string;
  stream_id: string;
  stream_generation: string;
  sequence: string;
  window_start_us: string;
  window_end_us: string;
  observed_at_ms: number;
  clock_anchor_id: string;
  clock_uncertainty_ms: number;
  device_profile_version: string;
  algorithm_version: string;
  model_version: string;
  feature_hash: string;
  contact: Contact;
  sqi: number | null;
  metrics: MetricSet;
}

export function toMetricEnvelope(frame: CoreMetricFrame, meta: EnvelopeMeta): MetricEnvelope {
  return {
    session_id: meta.sessionId,
    participant_id: meta.participantId,
    stream_id: meta.streamId,
    stream_generation: meta.streamGeneration,
    sequence: frame.sequence,
    window_start_us: frame.window_start_us,
    window_end_us: frame.window_end_us,
    observed_at_ms: frame.observed_at_ms,
    clock_anchor_id: meta.clockAnchorId,
    clock_uncertainty_ms: meta.clockUncertaintyMs,
    device_profile_version: meta.deviceProfileVersion,
    algorithm_version: meta.algorithmVersion,
    model_version: meta.modelVersion,
    feature_hash: frame.feature_hash,
    contact: frame.contact,
    sqi: frame.sqi,
    metrics: frame.metrics,
  };
}
