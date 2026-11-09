// SDD-320 F-1 — 코치 클래스 목록(시안 classes.html). PC 표 / 모바일 카드. 데이터는 기존 HostClassesPage 와 같은 useClasses 훅·어댑터를 쓴다.
import { useEffect, useMemo, useState } from 'react';
import { UiV2CoachCodeCard } from '../../../components/ui-v2/ui-v2-coach-code-card';
import { Link } from 'react-router-dom';
import AppShell from '../../../components/layout/AppShell';
import { ClassCreateAction } from '../../../components/class/structure/class-create-action';
import { useClasses } from '../../../hooks/use-class-structure';
import { adaptHostClass } from '../../../lib/class-structure/adapters';
import { classPath, classSessionPath } from '../../../lib/class-structure/navigation';
import { CLASS_FILTERS, filterClassRows, groupClassRows, toClassRow, type ClassGroupMode } from '../../../lib/coach-lists-v2';
import type { ClassSummaryDto } from '../../../lib/api/class-structure';
import { useAuthStore } from '../../../stores/authStore';
import { natureHeroStyle } from '../../../components/ui-v2/nature-hero';
import { ClassCard, ClassListHeader, NextClassView } from '../../../components/class/structure/host-class-views';
import '../../../components/class/structure/structure-shell.css';
import type { DisplayField } from '../../../lib/class-structure/read-model';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-pc.css';

/** 과거·전체 목록은 한 번에 이만큼씩 받고 '더 보기'로 이어 받는다(기존 목록과 같은 규칙). */
const PAGE_LIMIT = 30;
const SERVER_STATUS_FILTERS = new Set(['draft', 'completed', 'cancelled']);
const pageKey = (status: string | undefined, n: number): string => `${status ?? 'all'}:${n}`;
const fieldValue = <T,>(field: DisplayField<T>): T | undefined => (field.kind === 'value' ? field.value : undefined);

export function UiV2CoachClassesPage() {
  const user = useAuthStore((s) => s.user);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [group, setGroup] = useState<ClassGroupMode>('none');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<Record<string, ClassSummaryDto[]>>({});
  const { state, retry } = useClasses({ status: 'active' });
  const pagedStatus = SERVER_STATUS_FILTERS.has(filter) ? filter : undefined;
  const paged = useClasses({ status: pagedStatus, page, limit: PAGE_LIMIT }, filter !== 'active');
  const pagedRows = paged.state.status === 'success' ? paged.state.data.classes : null;
  useEffect(() => { if (pagedRows) setPages((previous) => (previous[pageKey(pagedStatus, page)] === pagedRows ? previous : { ...previous, [pageKey(pagedStatus, page)]: pagedRows })); }, [pagedRows, page, pagedStatus]);
  const changeFilter = (value: string): void => { setFilter(value); setPage(1); };

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const merged: ClassSummaryDto[] = [];
    const activeRows = state.status === 'success' ? state.data.classes : [];
    const loaded = Array.from({ length: page }, (_, i) => pages[pageKey(pagedStatus, i + 1)] ?? []).flat();
    for (const row of [...activeRows, ...loaded]) if (!seen.has(row.id)) { seen.add(row.id); merged.push(row); }
    return merged;
  }, [state, pages, page, pagedStatus]);
  const pagedTotal = paged.state.status === 'success' ? paged.state.data.total : 0;
  const hasMore = filter !== 'active' && pagedRows !== null && page * PAGE_LIMIT < pagedTotal;
  const classRows = useMemo(() => (state.status === 'success' ? rows.map((r) => toClassRow(adaptHostClass(r), user?.id, user?.role)) : []), [state.status, rows, user?.id, user?.role]);
  const shown = useMemo(() => filterClassRows(classRows, filter, query), [classRows, filter, query]);
  const groups = useMemo(() => groupClassRows(shown, group), [shown, group]);
  const opened = classRows.filter((r) => r.hasOpen);
  // 11/9 대표 지시: 운영 화면처럼 '지금 바로 시작' + '다음 회차' 안내를 상단에 (자연 배경)
  const nextClass = useMemo(() => {
    const models = state.status === 'success' ? rows.map(adaptHostClass) : [];
    const at = (m: (typeof models)[number]): number => { const n = fieldValue(m.nextSession); return Date.parse((n && fieldValue(n.scheduledAt)) || ''); };
    return models.filter((m) => at(m) >= Date.now()).sort((a, b) => at(a) - at(b))[0];
  }, [state.status, rows]);

  return (
    <AppShell title="함께 만드는 시간" rightSlot={<ClassCreateAction />}>
      <div className="ui-v2 u2f u2f-classes">
        {/* 11/9 대표 지시: 지금 함께할 시간(열린 회차)을 최상단에 */}
        {opened.length > 0 && <section aria-label="열려 있는 회차" className="u2-card u2-hero u2-hero--nature u2f-open-hero" style={natureHeroStyle(opened[0].id)}>
          <span className="u2-eyebrow">지금 함께할 시간</span><h2>열려 있는 회차가 있어요</h2>
          <div className="u2f-actions">{opened.map((r) => <Link key={r.id} className="u2-primary" to={r.openSessionId ? classSessionPath('host', r.id as never, r.openSessionId as never) : classPath('host', r.id as never)}>{r.title} · {r.openSessionId ? '회차 보기' : '클래스 보기'}</Link>)}</div>
        </section>}
        <Link to="/classes/now" className="u2-card u2-hero u2-hero--nature u2f-now-hero" style={natureHeroStyle('now')}>
          <span><strong>준비 없이 지금 수업을 열어야 하나요?</strong><small>이름·일정 입력 없이 바로 대기실을 열고 코드로 회원을 들여보내요.</small></span>
          <span className="u2f-now-btn">지금 바로 시작 →</span>
        </Link>
        {opened.length === 0 && nextClass && <div className="u2f-next-hero cs-structure"><NextClassView model={nextClass} showClassTitle /></div>}
        <UiV2CoachCodeCard />
        <p className="u2f-lead">함께할 클래스를 한눈에 살펴보고 바로 시작해요.</p>
        <div className="u2f-filters">
          <label className="u2-search"><span className="sr-only">클래스 검색</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="클래스 이름 검색" aria-label="클래스 검색" /></label>
          <select aria-label="그룹 기준" value={group} onChange={(e) => setGroup(e.target.value === 'status' ? 'status' : 'none')}><option value="none">그룹 없음</option><option value="status">상태별 그룹</option></select>
        </div>
        <div className="u2f-chips" role="group" aria-label="클래스 상태 필터">
          {CLASS_FILTERS.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => changeFilter(value)}>{label}</button>)}
        </div>
        {state.status === 'loading' && <p className="u2-empty" role="status">불러오는 중이에요</p>}
        {state.status === 'error' && <div className="u2-alert" role="alert"><p>목록을 불러오지 못했어요.</p><button type="button" className="u2-secondary u2-gap" onClick={retry}>다시 시도</button></div>}
        {state.status === 'success' && <>
          <p className="u2-muted" style={{ fontSize: 12, margin: '0 4px 8px' }}>현재 목록 {shown.length}개</p>
          {shown.length === 0 && <p className="u2-empty" role="status">{classRows.length === 0 ? '아직 클래스가 없어요' : '검색 결과가 없어요'}</p>}
          {/* 11/9 대표 지시: 운영 웹처럼 클래스별 카드(아이콘·다음 회차·진행 막대·지도사·상태) */}
          {groups.map((g) => {
            const byId = new Map(rows.map((row) => [row.id, row]));
            const models = g.rows.map((r) => byId.get(r.id)).filter((row): row is ClassSummaryDto => row != null).map(adaptHostClass);
            return (
              <section key={g.title || 'all'} aria-label={g.title || '클래스 목록'} className="cs-structure u2f-classcards">
                {g.title && <h2 className="u2f-group">{g.title} · {g.rows.length}</h2>}
                <div className="cs-class-list"><ClassListHeader />{models.map((model) => <ClassCard key={model.id} model={model} />)}</div>
              </section>
            );
          })}
          {hasMore && <button className="u2-secondary" type="button" onClick={() => setPage((v) => v + 1)}>이전 클래스 더 보기</button>}
          {paged.state.status === 'error' && <p role="status" className="u2-muted">이전 클래스를 불러오지 못했어요. <button type="button" className="u2-textlink" onClick={paged.retry}>다시 시도</button></p>}
        </>}
      </div>
    </AppShell>
  );
}
