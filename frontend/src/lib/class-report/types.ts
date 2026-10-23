export const METRIC_KEYS = ['respiration', 'bpm', 'hrv', 'focus', 'relaxation', 'emotional'] as const;
export type MetricKey = typeof METRIC_KEYS[number];
export type ClassReportStatus = 'zero' | 'pending' | 'error' | 'unworn' | 'lost' | 'single' | 'poor_signal' | 'partial' | 'measured';
export type Direction = 'up' | 'down' | 'stable';
export type MetricState = 'ok' | 'single' | 'missing' | 'poor_signal' | 'lost' | 'unworn';
export type NarrativeFieldKey = 'headline' | 'flow' | 'body_subtitle' | 'mind_subtitle' | `metric.${MetricKey}` | `participant.${string}`;
export interface NarrativeField {
  text: string; source: 'rule' | 'ai' | 'edited'; ai_draft: string | null; rule_text: string;
  edited_text: string | null; edited_by: string | null; edited_by_name: string | null; edited_at: string | null;
  stale: boolean; max_len: number;
}
export interface MetricSeriesPoint { t_min: number; v: number | null; n: number }
export interface ClassMetric {
  unit: string; state: MetricState; measured: number; compared: number;
  mean: number | null; min: number | null; max: number | null; early: number | null; late: number | null; delta: number | null;
  direction: Direction | null; valid_min: number | null; valid_ratio: number | null;
  agreement: { up: number; stable: number; down: number } | null; missing_reason: string | null; series: MetricSeriesPoint[];
}
export type ParticipantMeasurement = 'measured' | 'unworn' | 'poor_signal' | 'lost' | 'excluded';
export interface ParticipantMetric { mean: number | null; early: number | null; late: number | null; delta: number | null; direction: Direction | null; valid_min: number | null; valid_ratio: number | null }
export interface ClassReportScope { attended: number; measured: number; included: number; duration_min: number; bucket_min: number; split_min?: number }
export interface ClassReportBlock {
  schema_version: 1; status: ClassReportStatus; flags: ('partial' | 'lost' | 'poor_signal')[]; normalization_version: string | null;
  scope: ClassReportScope; metrics: Record<MetricKey, ClassMetric>;
  narrative: { prompt_version: string; model: string | null; input_hash: string; generated_at: string | null;
    ai_attempt: { hash: string; outcome: string; at: string } | null; fields: Record<string, NarrativeField>; fallback_fields: string[] };
  participants: { participant_id: string; state: ParticipantMeasurement; metrics: Partial<Record<MetricKey, ParticipantMetric>> }[];
}
export interface ReportGeneration { id: string | null; generation_status: 'pending' | 'processing' | 'ready' | 'failed' | 'none'; state: string; narrative_pending: boolean }
export interface ClassReportSession { id: string; class_name: string; seq: number | null; ended_at: string | null; duration_min: number }
export interface ParticipantRow {
  participant_id: string; display_name: string; kind: 'member' | 'guest'; order: number; included: boolean;
  exclusion: 'not_included' | 'absent' | null; measurement: ParticipantMeasurement;
  report: { id: string | null; generation: 'pending' | 'processing' | 'ready' | 'failed' | 'none'; approval: 'pending_analysis' | 'pending_review' | 'completed' | 'error' | 'none'; delivery: 'not_requested' | 'waiting' | 'sent' | 'failed' | 'no_address' | 'unknown' };
  narrative_field: string | null;
}
export interface ClassReportResponse { session: ClassReportSession; report: ReportGeneration; block: ClassReportBlock | null; participants: ParticipantRow[]; capabilities: { can_edit_narrative: boolean }; fetched_at: string }
export interface MetricChip { key: MetricKey; direction: Direction | null; state: 'ok' | 'single' | 'missing' | 'poor_signal' }
export interface ClassSummaryResponse {
  session: ClassReportSession & { class_id: string; started_at: string | null; domain: 'meditation' };
  headcount: { attended: number; measured: number | null; report_targets: number; excluded: number };
  report: ReportGeneration;
  class_report: { available: boolean; status: ClassReportStatus; flags: ClassReportBlock['flags']; scope: ClassReportScope;
    headline: Pick<NarrativeField, 'text' | 'source' | 'edited_by_name' | 'edited_at'> | null; chips: { body: MetricChip[]; mind: MetricChip[] } };
  approval: { auto_approve: { enabled: boolean; grace_minutes: 0 }; counts: { generating: number; pending_review: number; approved: number; error: number; no_data_manual: number }; participants_total: number };
  note_prompt: { eligible: boolean; has_note: boolean; seen: boolean; dismissed: boolean; user_enabled: boolean };
  next_session: { id: string; seq: number; scheduled_at: string } | null;
  capabilities: { can_edit_narrative: boolean; can_write_note: boolean; can_approve: boolean }; fetched_at: string;
}
export type NarrativePatchRequest = { field: NarrativeFieldKey; text: string; base_edited_at: string | null; revert?: never } | { field: NarrativeFieldKey; revert: true; text?: never; base_edited_at?: never };
export interface NarrativePatchResponse { field: NarrativeFieldKey; value: NarrativeField; fetched_at: string }
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const statuses: ClassReportStatus[] = ['zero', 'pending', 'error', 'unworn', 'lost', 'single', 'poor_signal', 'partial', 'measured'];
export function isClassReportResponse(value: unknown): value is ClassReportResponse {
  if (!isObject(value) || !isObject(value.session) || !isObject(value.report) || !isObject(value.capabilities) || !Array.isArray(value.participants) || typeof value.fetched_at !== 'string') return false;
  if (value.block === null) return true;
  if (!isObject(value.block) || !statuses.includes(value.block.status as ClassReportStatus) || !isObject(value.block.metrics) || !isObject(value.block.narrative)) return false;
  const metrics = value.block.metrics;
  return METRIC_KEYS.every((key) => isObject(metrics[key]) && typeof metrics[key].measured === 'number' && Array.isArray(metrics[key].series));
}
export function isClassSummaryResponse(value: unknown): value is ClassSummaryResponse {
  return isObject(value) && isObject(value.session) && isObject(value.headcount) && isObject(value.approval) && isObject(value.note_prompt) && isObject(value.capabilities) && isObject(value.class_report) && statuses.includes(value.class_report.status as ClassReportStatus) && typeof value.fetched_at === 'string';
}
