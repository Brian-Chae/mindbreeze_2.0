// SDD-323 F3 — 기관 관리자 탭. 권한 회수·대표 지정·소속 해지는 allowed_actions 에 있을 때만 렌더된다.
import type { CounselorItem } from '../../../../lib/api/org';
import { MemberList, type RowHandler } from './member-list';
import { ACCOUNT_LABEL, accountChipOf, adminsOf, groupRows, matchQuery } from './members-model';
import { MemberToolbar } from './member-toolbar';
import type { TabFilters } from './coaches-tab';

export function AdminsTab({
  items,
  filters,
  onFilters,
  onAction,
  onPickPromote,
}: {
  items: CounselorItem[];
  filters: TabFilters;
  onFilters: (patch: Partial<TabFilters>) => void;
  onAction: RowHandler;
  /** 승격 가능한 코치가 있을 때만 '기존 코치 지정' 버튼을 보여 준다. */
  onPickPromote: (() => void) | null;
}) {
  const all = adminsOf(items);
  const rows = all.filter((c) => matchQuery(c, filters.q) && (!filters.status || accountChipOf(c) === filters.status));
  const groups = filters.group === 'status' ? groupRows(rows, (c) => ACCOUNT_LABEL[accountChipOf(c)]) : [{ key: '', label: '', rows }];
  return (
    <section aria-labelledby="u2m-tab-title">
      <div className="u2m-sectionhead">
        <div><h2 id="u2m-tab-title">기관 관리자</h2><p>기관 운영 권한과 대표 관리자를 확인하세요.</p></div>
        {onPickPromote && <button type="button" className="u2-secondary u2m-inline" onClick={onPickPromote}>기존 코치 지정</button>}
      </div>
      <div className="u2m-note">활성 관리자는 최소 1명 유지합니다. 본인의 권한은 회수할 수 없습니다.</div>
      <MemberToolbar
        filters={filters}
        onFilters={onFilters}
        statusOptions={[['active', '활성'], ['limited', '이용 제한']]}
        groupOptions={[['status', '상태별']]}
        searchLabel="이름 또는 이메일 검색"
      />
      {all.length === 0 ? (
        <div className="u2-org-empty">표시할 기관 관리자가 없습니다.</div>
      ) : rows.length === 0 ? (
        <div className="u2-org-empty">검색 조건에 맞는 관리자가 없습니다.</div>
      ) : (
        groups.map((g) => (
          <div key={g.key || 'all'}>
            {g.key && <h3 className="u2m-grouphead">{g.label} · {g.rows.length}명</h3>}
            <MemberList rows={g.rows} variant="admins" onAction={onAction} />
          </div>
        ))
      )}
    </section>
  );
}
