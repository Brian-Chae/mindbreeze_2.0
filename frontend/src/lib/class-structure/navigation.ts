import { isCounselingEnabled } from '../feature-flags';
import type { ClassId, RelationshipId, SessionId, StructureRole } from './read-model';

const validId = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim().length > 0;
export const classListPath = (role: StructureRole): string => role === 'member' ? '/app/classes' : '/classes';
// SDD-219: 상담 비공개 시 상담 경로는 클래스 홈으로 대체한다.
export const counselingListPath = (role: StructureRole): string => !isCounselingEnabled() ? classListPath(role) : role === 'member' ? '/app/counseling' : '/counseling';
export function classPath(role: StructureRole, id: ClassId | null | undefined): string {
  return validId(id) ? `${classListPath(role)}/${encodeURIComponent(id)}` : classListPath(role);
}
export function counselingPath(role: StructureRole, id: RelationshipId | null | undefined): string {
  return validId(id) && isCounselingEnabled() ? `${counselingListPath(role)}/${encodeURIComponent(id)}` : counselingListPath(role);
}
export function classSessionPath(role: StructureRole, parent: ClassId | null | undefined, id: SessionId | null | undefined): string {
  if (!validId(parent) || !validId(id)) return classListPath(role);
  return role === 'member' ? `${classPath(role, parent)}?sessionId=${encodeURIComponent(id)}`
    : `${classPath(role, parent)}/sessions/${encodeURIComponent(id)}`;
}
export function counselingSessionPath(role: StructureRole, parent: RelationshipId | null | undefined, id: SessionId | null | undefined): string {
  if (!isCounselingEnabled() || !validId(parent) || !validId(id)) return counselingListPath(role);
  return role === 'member' ? `${counselingPath(role, parent)}?sessionId=${encodeURIComponent(id)}`
    : `${counselingPath(role, parent)}/sessions/${encodeURIComponent(id)}`;
}
/** 미지 영역은 유형명으로 분류하지 않고 기존 회차 이동을 유지한다. */
export interface SessionParentHint { area?: string | null; classId?: ClassId | null; relationshipId?: RelationshipId | null }
export function sessionPath(role: StructureRole, id: SessionId | null | undefined, parent?: SessionParentHint): string {
  if (parent?.area === 'meditation') return classSessionPath(role, parent.classId, id);
  if (parent?.area === 'counseling') return counselingSessionPath(role, parent.relationshipId, id);
  return validId(id) ? `${role === 'member' ? '/app' : ''}/sessions/${encodeURIComponent(id)}` : classListPath(role);
}
