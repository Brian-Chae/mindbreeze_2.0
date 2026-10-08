import { apiClient } from './client';

export type MoodDirection = 'better' | 'same' | 'watch';
export interface CheckinPrefs { available: boolean; paused: boolean }
export interface CheckinClient {
  client_id: string; client_name: string; enabled: boolean;
  last_checkin_at: string | null; open_risk_count: number;
}
export interface ProfileItem {
  id: string; category: 'sleep' | 'stress' | 'emotion' | 'coping' | 'people_events';
  text: string; status: 'ai_estimate' | 'confirmed' | 'dismissed';
  evidence_count: number; updated_at: string;
}
export interface CheckinSummary {
  id: string; client_id: string; started_at: string; closed_at: string | null;
  summary: string; mood_direction: MoodDirection | null;
}
export interface RiskSignal {
  id: string; client_id: string; client_name: string; level: 'watch' | 'high';
  excerpt: string; created_at: string; handled_at: string | null;
}
export interface ProfilePatch { status?: 'confirmed' | 'dismissed'; text?: string }
const prefix = '/agent/counselor';
// 공통 클라이언트가 !res.ok를 먼저 확인하고 성공 응답을 파싱한다.
export const getCheckinPrefs = () => apiClient.get<CheckinPrefs>('/agent/checkin-prefs');
export const putCheckinPrefs = (paused: boolean) => apiClient.put<CheckinPrefs>('/agent/checkin-prefs', { paused });
export const listCheckinClients = () => apiClient.get<{ items: CheckinClient[] }>(`${prefix}/checkin/clients`);
export const setCheckinEnabled = (id: string, enabled: boolean) => apiClient.put<CheckinClient>(`${prefix}/checkin/clients/${encodeURIComponent(id)}`, { enabled });
export const getProfile = (id: string) => apiClient.get<{ items: ProfileItem[] }>(`${prefix}/clients/${encodeURIComponent(id)}/profile`);
export const patchProfileItem = (id: string, patch: ProfilePatch) => apiClient.patch<ProfileItem>(`${prefix}/profile-items/${encodeURIComponent(id)}`, patch);
export const listCheckins = (id: string, limit = 20) => apiClient.get<{ items: CheckinSummary[] }>(`${prefix}/clients/${encodeURIComponent(id)}/checkins?${new URLSearchParams({ limit: String(limit) })}`);
export const listRiskSignals = (status: 'open' | 'all' = 'all', limit = 50) => apiClient.get<{ items: RiskSignal[] }>(`${prefix}/risk-signals?${new URLSearchParams({ status, limit: String(limit) })}`);
export const handleRiskSignal = (id: string) => apiClient.post<RiskSignal>(`${prefix}/risk-signals/${encodeURIComponent(id)}/handled`);
