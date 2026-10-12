// SDD-084 — 세션 영상 녹화 API 클라이언트 (audio.ts 패턴 복제)

import { apiClient } from './client';
import { uploadFormWithRetry } from './upload-helper';

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

export interface VideoUrlResponse {
  url: string | null;
}

export const startVideo = (sessionId: string, consentVideo: boolean): Promise<VideoStartResponse> =>
  apiClient.post<VideoStartResponse>(`/sessions/${sessionId}/video/start`, { consent_video: consentVideo });

export const stopVideo = (sessionId: string, expectedCount?: number): Promise<VideoStopResponse> =>
  apiClient.post<VideoStopResponse>(
    `/sessions/${sessionId}/video/stop`,
    expectedCount !== undefined ? { expected_count: expectedCount } : undefined,
  );

// 리포트 영상 리플레이용 presigned GET URL 조회
export const getSessionVideoUrl = (sessionId: string): Promise<VideoUrlResponse> =>
  apiClient.get<VideoUrlResponse>(`/sessions/${sessionId}/video/url`);

/** stream 상대 경로("/api/v1/...") → API base origin과 결합해 절대 URL로 */
export function resolveVideoUrl(url: string): string {
  if (!url || url.startsWith('http')) return url;
  const origin = BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${origin}${url}`;
}

// multipart 청크 업로드는 별도 fetch (apiClient는 JSON 전용)
export async function uploadVideoChunk(
  sessionId: string,
  chunkIndex: number,
  blob: Blob,
): Promise<VideoChunkUploadResponse> {
  const fd = new FormData();
  fd.append('chunk_index', String(chunkIndex));
  fd.append('file', blob, `chunk_${chunkIndex}.webm`);

  // SDD-101 C3: timeout·재시도(5xx/타임아웃만) 적용
  return uploadFormWithRetry<VideoChunkUploadResponse>(`${BASE_URL}/sessions/${sessionId}/video/chunk`, fd);
}
