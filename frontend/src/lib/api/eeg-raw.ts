/**
 * SDD-117 — EEG raw chunk API (presigned PUT + ack)
 *
 * BE 계약(schemas/eeg.py, api/v1/session.py)과 정렬:
 * - presign: POST /sessions/{id}/eeg-raw/presign  body={participant_id, play_group_id, chunks:[…]}
 * - ack:     POST /sessions/{id}/eeg-raw/ack       body={participant_id, play_group_id, chunks:[{chunk_id, checksum, size_bytes}]}
 * - S3 PUT:  presigned URL에 raw 바이트(application/octet-stream)
 */

import { apiClient } from './client';

/** presign 요청 — raw 재해석 계약 메타 1건 */
export interface EegRawChunkMeta {
  stream_id: string;
  chunk_index: number;
  start_ms: number | null;
  end_ms: number | null;
  sample_rate: number;
  channel_count: number;
  unit: string;
  schema_version: string;
  checksum: string | null;
  size_bytes: number | null;
  content_type: string;
}

export interface EegRawPresignRequest {
  participant_id: string | null;
  play_group_id?: string | null;
  chunks: EegRawChunkMeta[];
}

export interface EegRawPresignItem {
  chunk_id: string;
  stream_id: string;
  chunk_index: number;
  object_key: string;
  upload_url: string;
  upload_status: string;
}

export interface EegRawPresignResponse {
  session_id: string;
  participant_id: string | null;
  chunks: EegRawPresignItem[];
}

export interface EegRawAckItem {
  chunk_id: string;
  checksum: string | null;
  size_bytes: number | null;
}

export interface EegRawAckRequest {
  participant_id: string | null;
  play_group_id?: string | null;
  chunks: EegRawAckItem[];
}

export interface EegRawAckResponse {
  session_id: string;
  acked: number;
  eeg_record_id: string | null;
  file_count: number;
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

export const ackEegRawChunks = (
  sessionId: string,
  body: EegRawAckRequest,
  options?: { skipAuth?: boolean },
): Promise<EegRawAckResponse> =>
  apiClient.post<EegRawAckResponse>(
    `/sessions/${sessionId}/eeg-raw/ack`,
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
