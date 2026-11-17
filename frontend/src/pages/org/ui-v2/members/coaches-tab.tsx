// SDD-323 F3 — 코치 탭: 검색 + 상태 필터 + 그룹핑(상태별·활동 형태별).
import type { CounselorItem } from '../../../../lib/api/org';
import { MemberList, type RowHandler } from './member-list';
import { ACCOUNT_LABEL, accountChipOf, coachesOf, groupRows, matchQuery, type MemberGroup } from './members-model';
import { MemberToolbar } from './member-toolbar';

export interface TabFilters { q: string; status: string; group: MemberGroup }

export function CoachesTab({ items, filters, onFilters, onAction }: { items: CounselorItem[]; filters: TabFilters; onFilters: (patch: Partial<TabFilters>) => void; onAction: RowHandler }) {
  const all = coachesOf(items);
  const rows = all.filter((c) => matchQuery(c, filters.q) && (!filters.status || accountChipOf(c) === filters.status));
  const groups = filters.group === 'status'
    ? groupRows(rows, (c) => ACCOUNT_LABEL[accountChipOf(c)])
    : filters.group === 'office'
      ? groupRows(rows, (c) => (c.has_personal_office ? '개인 상담소' : '기관 소속'))
      : [{ key: '', label: '', rows }];
  return (
    <section aria-labelledby="u2m-tab-title">
      <div className="u2m-sectionhead"><div><h2 id="u2m-tab-title">코치</h2><p>코치의 활동과 소속을 확인하세요.</p></div></div>
      <MemberToolbar
        filters={filters}
        onFilters={onFilters}
        statusOptions={[['active', '활성'], ['limited', '이용 제한']]}
        groupOptions={[['status', '상태별'], ['office', '활동 형태별']]}
        searchLabel="이름 또는 이메일 검색"
      />
      {all.length === 0 ? (
        <div className="u2-org-empty">아직 소속된 코치가 없습니다. 상단의 '구성원 초대'로 코치를 초대해 보세요.</div>
      ) : rows.length === 0 ? (
        <div className="u2-org-empty">검색 조건에 맞는 코치가 없습니다.</div>
      ) : (
        groups.map((g) => (
          <div key={g.key || 'all'}>
            {g.key && <h3 className="u2m-grouphead">{g.label} · {g.rows.length}명</h3>}
            <MemberList rows={g.rows} variant="coaches" onAction={onAction} />
          </div>
        ))
      )}
    </section>
  );
}
