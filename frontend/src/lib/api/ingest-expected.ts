// SDD-264 — 폰 생성량(기대량) 보고 REST. 정본: specs/sdd-264-upload-progress-expected/contract.md §1.
// 인증은 features/batch 와 동일(JWT 또는 X-Entry-Credential).
import { apiClient } from './client';
import type { FeatureAuth } from './feature-batch';

export interface RawExpectedBody { eeg: number; ppg: number; acc: number }
export interface IngestExpectedBody {
  participant_id?: string;
  feature: number;
  /** 있으면 3신호 모두. 생략 = 원시 미보고 */
  raw?: RawExpectedBody;
  final: boolean;
}
export interface IngestExpectedResponse {
  session_id: string; participant_id: string;
  expected: { feature: number; raw: { eeg: number | null; ppg: number | null; acc: number | null } };
  final: boolean; changed: boolean; ignored: string[]; updated_at: string;
}

const opts = (a: FeatureAuth): { skipAuth: boolean; headers?: Record<string, string> } =>
  a.entryCredential ? { skipAuth: true, headers: { 'X-Entry-Credential': a.entryCredential } } : { skipAuth: a.skipAuth ?? false };

export function putIngestExpected(sessionId: string, body: IngestExpectedBody, auth: FeatureAuth): Promise<IngestExpectedResponse> {
  return apiClient.put<IngestExpectedResponse>(`/sessions/${encodeURIComponent(sessionId)}/ingest-expected`, body, opts(auth));
}
