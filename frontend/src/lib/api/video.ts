// SDD-084 — 세션 영상 녹화 API 클라이언트 (audio.ts 패턴 복제)

import { apiClient, tokenStorage, ApiError } from './client';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api/v1';

export interface VideoStartResponse {
  session_id: string;
  status: string;
  started_at: string | null;
}

export interface VideoChunkUploadResponse {
  chunk_index: number;
  received_bytes: number;
  total_chunks: number;
}

export interface VideoStopResponse {
  session_id: string;
  status: string;
  total_chunks: number;
  ended_at: string | null;
}

export const startVideo = (sessionId: string, consentVideo: boolean): Promise<VideoStartResponse> =>
  apiClient.post<VideoStartResponse>(`/sessions/${sessionId}/video/start`, { consent_video: consentVideo });

export const stopVideo = (sessionId: string): Promise<VideoStopResponse> =>
  apiClient.post<VideoStopResponse>(`/sessions/${sessionId}/video/stop`);

// multipart 청크 업로드는 별도 fetch (apiClient는 JSON 전용)
export async function uploadVideoChunk(
  sessionId: string,
  chunkIndex: number,
  blob: Blob,
): Promise<VideoChunkUploadResponse> {
  const fd = new FormData();
  fd.append('chunk_index', String(chunkIndex));
  fd.append('file', blob, `chunk_${chunkIndex}.webm`);

  const token = tokenStorage.getAccess();
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/video/chunk`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    const msg = (data && typeof data === 'object' && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string')
      ? (data as { detail: string }).detail
      : `영상 청크 업로드 실패 (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return (await res.json()) as VideoChunkUploadResponse;
}
