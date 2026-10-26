import { apiClient } from './client';
export interface ParticipationRow {
  participant_id: string;
  member_id: string | null;
  canonical_member_id: string | null;
  attendance_status: 'expected' | 'attended' | 'absent' | 'excused' | 'withdrawn';
  entered_at: string | null;
  checkin_state: 'completed' | 'not_completed' | 'unknown';
  checkin_at: string | null;
  presence_state: 'connected' | 'disconnected' | 'unknown';
  presence_expires_at: string | null;
}
export interface ParticipationSnapshot {
  session_id: string;
  participation_version: number;
  generated_at?: string;
  presence_ttl_seconds?: number;
  participants: ParticipationRow[];
}
export async function getParticipation(classId: string, sessionId: string): Promise<ParticipationSnapshot> {
  const response = await apiClient.get<ParticipationSnapshot>(`/classes/${classId}/sessions/${sessionId}/participation`);
  return response;
}
