/** 부모와 회차 식별자를 섞어 전달하지 않도록 구분한다. */
declare const idBrand: unique symbol;
export type ClassId = string & { readonly [idBrand]: 'class' };
export type RelationshipId = string & { readonly [idBrand]: 'relationship' };
export type SessionId = string & { readonly [idBrand]: 'session' };
function checkedId(value: string): string {
  if (!value.trim()) throw new Error('식별자를 확인할 수 없습니다.');
  return value;
}
export const asClassId = (value: string): ClassId => checkedId(value) as ClassId;
export const asRelationshipId = (value: string): RelationshipId => checkedId(value) as RelationshipId;
export const asSessionId = (value: string): SessionId => checkedId(value) as SessionId;
export type StructureRole = 'host' | 'member';
export type DisplayField<T> = { kind: 'value'; value: T } | { kind: 'no_data'; label: '데이터 없음' };
export function displayField<T>(value: T | null | undefined): DisplayField<T> {
  return value === null || value === undefined
    ? { kind: 'no_data', label: '데이터 없음' } : { kind: 'value', value };
}
export type ReadState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: '목록을 불러오지 못했어요' }
  | { status: 'not_found'; message: '내용을 찾을 수 없어요' };
