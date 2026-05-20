// AI 리포트 API 클라이언트

import { apiClient } from './client';

export type ReportType = 'counselor' | 'client';

export interface ReportDto {
  id: string;
  session_id: string;
  user_id: string;
  type: ReportType;
  content: Record<string, unknown>;
  pdf_url: string | null;
  sent_at: string | null;
  is_read: boolean;
  created_at: string | null;
  session_title: string | null;
  session_type: string | null;
  scheduled_at: string | null;
}

export interface ReportListResponse {
  reports: ReportDto[];
  total: number;
}

export const listReports = (): Promise<ReportListResponse> =>
  apiClient.get<ReportListResponse>('/reports');

export const getReport = (id: string): Promise<ReportDto> =>
  apiClient.get<ReportDto>(`/reports/${id}`);

export const generateReport = (sessionId: string, type: ReportType = 'counselor'): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/generate/${sessionId}`, { type });

export const updateReport = (id: string, content: Record<string, unknown>): Promise<ReportDto> =>
  apiClient.put<ReportDto>(`/reports/${id}`, { content });

export const approveReport = (id: string, note?: string): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/${id}/approve`, { note });
