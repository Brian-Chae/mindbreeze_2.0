import { apiClient, ApiError } from './client';

export interface ClassCodeSession {
  session_id: string;
  seq: number | null;
  scheduled_at: string | null;
  status: string;
}
export interface ClassCodeResult {
  revision?: number;
  class_id: string;
  title: string | null;
  sessions: ClassCodeSession[];
  next_session: ClassCodeSession | null;
}

/** 스위치 비활성 또는 부모 코드 미존재일 때만 기존 단건 코드 흐름으로 이어진다. */
export async function resolveClassCode(code: string, signal?: AbortSignal): Promise<ClassCodeResult | null> {
  try {
    return await apiClient.post<ClassCodeResult>('/classes/resolve-code', { code }, { skipAuth: true, signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function joinClassCode(classId: string, code: string, signal?: AbortSignal) {
  return apiClient.post<{ class_id: string; member_id: string; status: string }>(
    `/classes/${encodeURIComponent(classId)}/join`, { code }, { signal },
  );
}
