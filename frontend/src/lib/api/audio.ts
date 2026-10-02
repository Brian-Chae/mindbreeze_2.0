// AI 자동 기록 API 클라이언트

import { apiClient } from './client';
import { uploadFormWithRetry } from './upload-helper';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api/v1';

export interface AudioStartResponse {
  session_id: string;
  status: string;
  started_at: string | null;
}

export interface ChunkUploadResponse {
  chunk_index: number;
  received_bytes: number;
  total_chunks: number;
}

export interface AudioStopResponse {
  session_id: string;
  status: string;
  total_chunks: number;
  ended_at: string | null;
}

export interface TranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface TranscriptResponse {
  session_id: string;
  status: string;
  segments: TranscriptSegment[];
  raw_text: string | null;
}

export interface RecordResponse {
  session_id: string;
  status: string;
  transcript: string | null;
  ai_summary: Record<string, unknown>;
  counselor_notes: string | null;
  markers: Array<Record<string, unknown>>;
  is_edited: boolean;
  edit_history: Array<Record<string, unknown>>;
  // SDD-101 D1: 영상 저장 무결성 — merge_failed/누락 표시용
  video_status?: string;
  video_expected_chunks?: number | null;
  video_actual_chunks?: number | null;
}

export const startAudio = (sessionId: string, consentAudio: boolean): Promise<AudioStartResponse> =>
  apiClient.post<AudioStartResponse>(`/sessions/${sessionId}/audio/start`, { consent_audio: consentAudio });

export const stopAudio = (sessionId: string): Promise<AudioStopResponse> =>
  apiClient.post<AudioStopResponse>(`/sessions/${sessionId}/audio/stop`);

export const getRecord = (sessionId: string): Promise<RecordResponse> =>
  apiClient.get<RecordResponse>(`/sessions/${sessionId}/record`);

export const updateRecord = (
  sessionId: string,
  payload: { counselor_notes?: string; ai_summary?: Record<string, unknown> },
): Promise<RecordResponse> => apiClient.put<RecordResponse>(`/sessions/${sessionId}/record`, payload);

export const getTranscript = (sessionId: string): Promise<TranscriptResponse> =>
  apiClient.get<TranscriptResponse>(`/sessions/${sessionId}/transcript`);

// multipart 청크 업로드는 별도 fetch (apiClient는 JSON 전용)
export async function uploadChunk(
  sessionId: string,
  chunkIndex: number,
  blob: Blob,
): Promise<ChunkUploadResponse> {
  const fd = new FormData();
  fd.append('chunk_index', String(chunkIndex));
  fd.append('file', blob, `chunk_${chunkIndex}.webm`);

  // SDD-101 C3: timeout·재시도(5xx/타임아웃만) 적용
  return uploadFormWithRetry<ChunkUploadResponse>(`${BASE_URL}/sessions/${sessionId}/audio/chunk`, fd);
}
