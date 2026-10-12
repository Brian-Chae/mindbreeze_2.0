/**
 * 정규화 API 클라이언트 — SDD-036 (baseline + 표준 모델)
 *
 * BASE: `/normalization` (apiClient BASE_URL 이 이미 `/api/v1`)
 * 인증: mindbreeze JWT (apiClient Bearer)
 */
import { ApiError, apiClient, tokenStorage } from './client';
import type { CalibrationBaseline, ScoreDirection } from '../eeg/eegSigmoidScore';

export interface NormalizationBaselineDto {
  id: string | number;
  user_id: string;
  device_id: string | null;
  pipeline_version: string | null;
  gender: string | null;
  birth_date: string | null;
  closed: CalibrationBaseline;
  open: CalibrationBaseline;
  created_at: string;
  is_active: boolean;
}

export interface CreateBaselineRequest {
  closed: CalibrationBaseline;
  open: CalibrationBaseline;
  device_id: string | null;
  pipeline_version: string | null;
  gender: 'male' | 'female' | null;
  birth_date: string | null;
}

export interface BaselineListResponse {
  items: NormalizationBaselineDto[];
}

/** 표준 분포 모델 (지표별 {m,s,direction}) */
export type NormalizationModelParams = Record<
  string,
  { m: number; s: number; direction: ScoreDirection } | undefined
>;

export interface NormalizationModelDto {
  id: string | number;
  version: number | string;
  n_samples: number;
  params: NormalizationModelParams;
  created_at: string;
  is_active: boolean;
}

export interface ModelListResponse {
  items: NormalizationModelDto[];
}

export interface ActiveModelResponse {
  active: NormalizationModelDto | null;
}

/** POST /normalization/baselines — 기준 생성 */
export async function createBaseline(
  body: CreateBaselineRequest,
): Promise<NormalizationBaselineDto> {
  return apiClient.post<NormalizationBaselineDto>('/normalization/baselines', body);
}

/** GET /normalization/baselines — 기준 목록 */
export async function listBaselines(): Promise<NormalizationBaselineDto[]> {
  const data = await apiClient.get<BaselineListResponse>('/normalization/baselines');
  return data.items ?? [];
}

/** DELETE /normalization/baselines/{id} */
export async function deleteBaseline(id: string | number): Promise<void> {
  await apiClient.delete<void>(`/normalization/baselines/${encodeURIComponent(String(id))}`);
}

/** POST /normalization/models/compute — 전체 baseline으로 표준 모델 계산 */
export async function computeModel(): Promise<NormalizationModelDto> {
  return apiClient.post<NormalizationModelDto>('/normalization/models/compute');
}

/** GET /normalization/models — 표준 모델 목록 */
export async function listModels(): Promise<NormalizationModelDto[]> {
  const data = await apiClient.get<ModelListResponse>('/normalization/models');
  return data.items ?? [];
}

/** GET /normalization/models/active — 현재 활성 표준 모델 */
export async function getActiveModel(): Promise<NormalizationModelDto | null> {
  const data = await apiClient.get<ActiveModelResponse>('/normalization/models/active');
  return data.active ?? null;
}

/** POST /normalization/models/{id}/activate — 표준 모델 시스템 적용 */
export async function activateModel(id: string | number): Promise<NormalizationModelDto> {
  const data = await apiClient.post<{ active: NormalizationModelDto }>(
    `/normalization/models/${encodeURIComponent(String(id))}/activate`,
  );
  return data.active;
}

/** JWT 보유 여부 (버튼 활성/비활성용) */
export function isNormalizationAuthReady(): boolean {
  return tokenStorage.getAccess() !== null;
}

export { ApiError };
