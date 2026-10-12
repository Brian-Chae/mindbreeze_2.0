// SDD-071: ZIP 바이트는 API를 경유하지 않고 S3에서 직접 내려받는다.
import { apiClient } from './client';

export type DataExportState = 'queued' | 'preparing' | 'ready' | 'ready_with_warnings' | 'failed' | 'expired' | 'cancelled';

export interface DataExportJob {
  export_id: string;
  status: DataExportState;
  stage: string;
  target_count: number;
  completed_count: number;
  size_bytes: number | null;
  warnings: string[];
  error_code: string | null;
  expires_at: string;
  snapshot_at: string | null;
  status_url: string;
}

export function createDataExport(sessionId: string, participantId: string, purpose: string, idempotencyKey: string) {
  return apiClient.post<DataExportJob>(
    `/sessions/${sessionId}/participants/${participantId}/data-exports`,
    { include: ['features', 'report'], purpose },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export function getDataExport(exportId: string) {
  return apiClient.get<DataExportJob>(`/data-exports/${exportId}`);
}

export function getDataExportDownloadUrl(exportId: string) {
  return apiClient.post<{ url: string; expires_at: string }>(`/data-exports/${exportId}/download-url`);
}
