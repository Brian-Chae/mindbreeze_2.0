// SDD-323 — 탭 공용 검색·필터·그룹핑 바. 값은 부모가 URL 쿼리로 보관한다.
import type { MemberGroup } from './members-model';

export function MemberToolbar({
  filters,
  onFilters,
  statusOptions,
  groupOptions,
  searchLabel,
}: {
  filters: { q: string; status: string; group: MemberGroup };
  onFilters: (patch: { q?: string; status?: string; group?: MemberGroup }) => void;
  statusOptions: ReadonlyArray<readonly [string, string]>;
  groupOptions: ReadonlyArray<readonly [string, string]>;
  searchLabel: string;
}) {
  return (
    <div className="u2-org-filter">
      <input aria-label={searchLabel} placeholder={searchLabel} value={filters.q} onChange={(e) => onFilters({ q: e.target.value })} />
      <select aria-label="상태 필터" value={filters.status} onChange={(e) => onFilters({ status: e.target.value })}>
        <option value="">모든 상태</option>
        {statusOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select aria-label="그룹핑" value={filters.group} onChange={(e) => onFilters({ group: e.target.value as MemberGroup })}>
        <option value="">그룹 없음</option>
        {groupOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
