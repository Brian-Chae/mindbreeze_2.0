import { apiClient } from './client';

export interface ClassMemberCandidate { id: string; name: string | null; masked_email: string }
export interface ClassMemberCandidates { members: ClassMemberCandidate[]; has_more: boolean }
export function searchClassMemberCandidates(
  params: { query?: string; classId?: string }, signal?: AbortSignal,
): Promise<ClassMemberCandidates> {
  const query = new URLSearchParams();
  if (params.classId) query.set('class_id', params.classId);
  if (params.query?.trim()) query.set('q', params.query.trim());
  return apiClient.get<ClassMemberCandidates>(`/classes/member-candidates${query.size ? `?${query}` : ''}`, { signal });
}
