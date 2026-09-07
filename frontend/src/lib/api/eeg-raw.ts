/**
 * SDD-027 — EEG raw chunk API (presigned PUT + ack)
 *
 * 흐름: 로컬 큐 적재 → presign → S3 PUT → ack → 큐 삭제
 * 게스트는 skipAuth + participant_id 로 소유 검증(SDD-026 재사용 전제).
 */

import { apiClient } from './client';

/** presign 요청 — manifest 메타 */
export interface EegRawPresignRequest {
  participant_id: string | null;
  stream_id: string;
  chunk_index: number;
  started_at: string;
  ended_at: string;
  sample_rate: number;
  channels: string[];
  unit: string;
  schema_version: string;
  checksum: string;
  byte_size: number;
  content_type?: string;
}

export interface EegRawPresignResponse {
  chunk_id: string;
  upload_url: string;
  object_key: string;
  /** S3 PUT에 포함할 추가 헤더(있으면 그대로 전달) */
  headers?: Record<string, string> | null;
  expires_at?: string | null;
}

export interface EegRawAckRequest {
  checksum: string;
  byte_size: number;
  participant_id?: string | null;
}

export interface EegRawAckResponse {
  chunk_id: string;
  status: string;
}

export const requestEegRawPresign = (
  sessionId: string,
  body: EegRawPresignRequest,
  options?: { skipAuth?: boolean },
): Promise<EegRawPresignResponse> =>
  apiClient.post<EegRawPresignResponse>(
    `/sessions/${sessionId}/eeg-raw/presign`,
    body,
    { skipAuth: options?.skipAuth ?? false },
  );

export const ackEegRawChunk = (
  sessionId: string,
  chunkId: string,
  body: EegRawAckRequest,
  options?: { skipAuth?: boolean },
): Promise<EegRawAckResponse> =>
  apiClient.post<EegRawAckResponse>(
    `/sessions/${sessionId}/eeg-raw/${chunkId}/ack`,
    body,
    { skipAuth: options?.skipAuth ?? false },
  );

/**
 * presigned URL로 raw 바이트 PUT.
 * Authorization/JSON Content-Type을 붙이지 않는다(1.0 S3Manager 패턴).
 */
export async function putEegRawToPresignedUrl(
  uploadUrl: string,
  payload: ArrayBuffer,
  headers?: Record<string, string> | null,
): Promise<void> {
  const merged: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    ...(headers ?? {}),
  };
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: merged,
    body: payload,
  });
  if (!res.ok) {
    throw new Error(`raw S3 PUT 실패 (${res.status})`);
  }
}
