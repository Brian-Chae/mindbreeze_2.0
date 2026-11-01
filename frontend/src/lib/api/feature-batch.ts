// SDD-260 W1 — feature 정본 저장 REST(contract.md §1·§2). 인증은 업로드와 동일(JWT 또는 X-Entry-Credential).
import type { FeatureResult } from '../measurement-web/metric-outbox';
import type { FeatureSummary } from '../measurement-web/feature-reconcile';
import type { MetricEnvelope } from '../measurement-web/envelope';
import { apiClient } from './client';

export interface FeatureAuth { entryCredential?: string | null; skipAuth?: boolean }
export interface FeatureBatchResponse {
  session_id: string; participant_id: string; results: FeatureResult[];
  counts: { accepted: number; duplicate: number; rejected: number };
}

const opts = (a: FeatureAuth): { skipAuth: boolean; headers?: Record<string, string> } =>
  a.entryCredential ? { skipAuth: true, headers: { 'X-Entry-Credential': a.entryCredential } } : { skipAuth: a.skipAuth ?? false };
const path = (sessionId: string, tail: string): string => `/sessions/${encodeURIComponent(sessionId)}/${tail}`;

/** 한 번에 1~300창. 창 단위 거절은 200 + rejected, 요청 전체 오류는 ApiError(422 등) */
export function postFeatureBatch(sessionId: string, participantId: string, windows: MetricEnvelope[], auth: FeatureAuth): Promise<FeatureBatchResponse> {
  return apiClient.post<FeatureBatchResponse>(path(sessionId, 'features/batch'), { participant_id: participantId, windows }, opts(auth));
}

export function getFeatureSummary(sessionId: string, participantId: string, auth: FeatureAuth): Promise<FeatureSummary> {
  return apiClient.get<FeatureSummary>(`${path(sessionId, 'features/summary')}?participant_id=${encodeURIComponent(participantId)}`, opts(auth));
}
