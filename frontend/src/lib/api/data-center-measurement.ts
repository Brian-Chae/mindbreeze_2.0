import { apiClient } from './client';
export type SignalType = 'eeg' | 'ppg' | 'acc';
export interface MeasurementSelection { fromUs: string; toUs: string }
export interface MeasurementMetadata {
 session_id:string; participant_id:string; alias:string; as_of:string; manifest_revision:number|null; manifest_state:string;
 signals:{signal:string;availability:string;unavailable_reason:string|null;sample_count:{value:number|null;partial:boolean;unavailable_reason:string|null}}[];
 feature_windows:{value:number|null;partial:boolean;unavailable_reason:string|null};consent:string;retention_deadline:string|null;allowed_formats:string[];band_used:boolean;default_view:string;
}
export interface WaveformChannel { name: string; unit: string; values: (number | null)[] | null; min: (number | null)[] | null; max: (number | null)[] | null }
export interface WaveformResponse {
 session_id: string; participant_id: string; signal_type: SignalType; availability: string; unavailable_reason: string | null;
 manifest_revision: number | null; from_us: string | null; to_us: string | null; method: 'raw' | 'minmax_envelope' | 'none'; max_points: number; source_sample_count: number; returned_count: number;
 nominal_rate_hz: number | null; observed_rate_hz: number | null; time_basis: string; t_us: string[]; channels: WaveformChannel[];
 segments: { stream_id: string; segment_id: string; point_start: number; point_end: number }[];
 gaps: { start_us: string; end_us: string; reason: string }[]; null_reasons: Record<string, string>;
}
export interface FeaturePage { session_id: string; participant_id: string; as_of: string; detail_emit?: string; time_origin?: string; algorithm_versions: Record<string, string>; items: { window_index: number; t_rel_ms: number | null; quality: string; source: string; values: Record<string, number | null>; units: Record<string,string> }[]; next_cursor: string | null; total: number | null }
export interface IndexMetric { value: number | null; status: string; source: string; reason: string | null }
export const indexDefinitions = [['focus', '집중도 · 표시값 %'], ['relaxation', '이완도 · 표시값 %'], ['emotional_balance', '감정균형도 · 표시값 %'], ['bpm', 'BPM · bpm'], ['respiration', '호흡 · 회/분'], ['hrv_sdnn_ms', 'HRV SDNN · ms']] as const;
export type IndexKey = typeof indexDefinitions[number][0];
export type IndexRow = Record<IndexKey, IndexMetric> & { t_rel_ms: number | null; model_version: string | null };
export interface IndicesPage { session_id: string; participant_id: string; as_of: string; view: string; items: IndexRow[]; next_cursor: string | null; note: string | null }
export interface SpectrumResponse { computable: boolean; reason: string | null; method: string; unit: string; freq_hz: number[]; channels: { name: string; psd: number[] }[]; window_sec: number; overlap: number }
function get<T>(s: string, p: string, resource: string, range: MeasurementSelection, orgId: string | undefined, signal: AbortSignal | undefined, extra: Record<string,string> = {}) {
 const query = new URLSearchParams({ from_us: range.fromUs, to_us: range.toUs, ...extra });
 if (orgId) query.set('org_id', orgId);
 return apiClient.get<T>(`/data-center/measurements/${encodeURIComponent(s)}/${encodeURIComponent(p)}/${resource}?${query}`, { signal });
}
export const measurementApi = {
 detail: (s:string,p:string,org?:string,abort?:AbortSignal)=>apiClient.get<MeasurementMetadata>(`/data-center/measurements/${encodeURIComponent(s)}/${encodeURIComponent(p)}${org?'?org_id='+encodeURIComponent(org):''}`,{signal:abort}),
 waveform: (s: string, p: string, range: MeasurementSelection, type: SignalType, org?: string, abort?: AbortSignal) => get<WaveformResponse>(s,p,'waveform',range,org,abort,{ signal_type:type, max_points:'2000' }),
 features: (s: string,p: string,range: MeasurementSelection,org?: string,abort?: AbortSignal,cursor?: string) => get<FeaturePage>(s,p,'features',range,org,abort,{ limit:'1000', ...(cursor ? { cursor } : {}) }),
 // B04 indices는 범위 필터를 지원하지 않아 페이지를 받은 뒤 화면에서 [from,to)로 좁힌다.
 indices: (s: string,p: string,_range: MeasurementSelection,org?: string,abort?: AbortSignal,cursor?: string) => {
  const query=new URLSearchParams({limit:'1000',...(org?{org_id:org}:{}),...(cursor?{cursor}:{})});
  return apiClient.get<IndicesPage>(`/data-center/measurements/${encodeURIComponent(s)}/${encodeURIComponent(p)}/indices?${query}`,{signal:abort});
 },
 spectrum: (s: string,p: string,range: MeasurementSelection,org?: string,abort?: AbortSignal) => get<SpectrumResponse>(s,p,'spectrum',range,org,abort),
};
