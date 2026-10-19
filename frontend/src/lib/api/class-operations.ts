import { apiClient } from './client';
import type { WriteCommand } from './class-scheduling';
export interface ClassMember { id: string; user_id: string | null; name: string | null; status: string }
export interface ClassInstructor { user_id: string; role: 'lead' | 'assistant' | 'guest'; status: string; scope_session_id: string | null }
export interface Observation { token: string; room_name: string; snapshot: { session_id: string; status: string; state_version: number; started_at: string | null; role: 'observer' } }
const path = (id: string) => `/classes/${encodeURIComponent(id)}`;
export const classOperationsApi = {
  members: (id: string) => apiClient.get<{ members: ClassMember[] }>(`${path(id)}/members`),
  inviteMembers: (id: string, command: WriteCommand & { user_ids: string[]; reactivate: boolean }) => apiClient.post<unknown>(`${path(id)}/members`, command),
  instructors: (id: string) => apiClient.get<{ instructors: ClassInstructor[] }>(`${path(id)}/instructors`),
  addInstructor: (id: string, command: WriteCommand & { user_id: string; role: 'lead' | 'assistant' | 'guest'; scope_session_id?: string }) => apiClient.post<unknown>(`${path(id)}/instructors`, command),
  changeInstructor: (id: string, userId: string, command: WriteCommand & { role: 'lead' | 'assistant' | 'guest'; scope_session_id?: string }) => apiClient.patch<unknown>(`${path(id)}/instructors/${encodeURIComponent(userId)}`, command),
  removeInstructor: (id: string, userId: string, command: WriteCommand) => apiClient.delete<unknown>(`${path(id)}/instructors/${encodeURIComponent(userId)}`, { body: command }),
  transition: (id: string, command: WriteCommand & { action: 'complete' | 'cancel' | 'archive' | 'restore' | 'hide' }) => apiClient.post<unknown>(`${path(id)}/transition`, command),
  reports: (id: string, sessionId: string) => apiClient.get<{ reports: { id: string; type: 'counselor' | 'client'; status: string }[] }>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/reports`),
  correctHost: (id: string, sessionId: string, command: WriteCommand & { expected_state_version: number; mode: 'correct' | 'note'; candidate_host_id?: string; displayed_host_name?: string }) => apiClient.post<unknown>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/host-correction`, command),
  observe: (id: string, sessionId: string) => apiClient.post<Observation>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/observe`),
};
