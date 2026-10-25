/**
 * SDD-117 — EEG raw chunk API (presigned PUT + ack)
 *
 * BE 계약(schemas/eeg.py, api/v1/session.py)과 정렬:
 * - presign: POST /sessions/{id}/eeg-raw/presign  body={participant_id, play_group_id, chunks:[…]}
 * - ack:     POST /sessions/{id}/eeg-raw/ack       body={participant_id, play_group_id, chunks:[{chunk_id, checksum, size_bytes}]}
 * - S3 PUT:  presigned URL에 raw 바이트(application/octet-stream)
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { ApiError, apiClient } from './client';

const RAW_PUT_TIMEOUT_MS = 20_000;
const RAW_PUT_MAX_ATTEMPTS = 3;
const RAW_PUT_RETRY_BASE_DELAY_MS = 500;

function putSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 5xx/408/429·타임아웃·네트워크 오류만 재시도한다(4xx 서명 만료는 호출측 재-presign 대상). */
function isRetryablePutError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return err instanceof TypeError;
}

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
  failed?: number;
  chunks?: { chunk_id: string; upload_status: string; checksum: string | null; size_bytes: number | null }[];
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
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * 네이티브 앱(Capacitor)은 오리진이 https://localhost 라 S3 버킷 CORS 에 막힌다(dev: OPTIONS 403 → PUT 전량 실패).
 * 네이티브 HTTP 로 PUT 하면 WebView CORS 를 거치지 않는다. 서명 헤더는 그대로 보낸다.
 */
async function putViaNativeHttp(uploadUrl: string, payload: ArrayBuffer, headers: Record<string, string>): Promise<void> {
  const res = await CapacitorHttp.request({ url: uploadUrl, method: 'PUT', headers, data: toBase64(payload), dataType: 'file', readTimeout: RAW_PUT_TIMEOUT_MS, connectTimeout: RAW_PUT_TIMEOUT_MS });
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, `raw S3 PUT 실패 (${res.status})`, null);
}

const isNativePlatform = (): boolean => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

export async function putEegRawToPresignedUrl(
  uploadUrl: string,
  payload: ArrayBuffer,
  headers?: Record<string, string> | null,
): Promise<void> {
  const merged: Record<string, string> = headers ?? { 'Content-Type': 'application/octet-stream' };
  // API7-09: presigned PUT 은 토큰 없이 별도 fetch 로 나가 공통 클라이언트의 타임아웃·재시도를
  // 우회한다. 응답이 없으면 영구 pending 되고 순단 실패가 청크 유실로 이어지므로 상한·재시도를 둔다.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RAW_PUT_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RAW_PUT_TIMEOUT_MS);
    try {
      if (isNativePlatform()) { await putViaNativeHttp(uploadUrl, payload, merged); return; }
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: merged,
        body: payload,
        signal: controller.signal,
      });
      if (!res.ok) {
        // 4xx(서명 만료 포함)는 재시도해도 동일 — 호출측이 새 presign 으로 재시도한다.
        throw new ApiError(res.status, `raw S3 PUT 실패 (${res.status})`, null);
      }
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < RAW_PUT_MAX_ATTEMPTS - 1 && isRetryablePutError(err)) {
        await putSleep(RAW_PUT_RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
