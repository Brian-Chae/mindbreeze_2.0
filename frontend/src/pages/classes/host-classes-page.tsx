import type { DisplayField, SessionId } from '../../lib/class-structure/read-model';
import { useEffect, useMemo, useState } from 'react';
import type { ClassSummaryDto } from '../../lib/api/class-structure';
import { Link } from 'react-router-dom';
import { buttonClass, tabClass, fieldClass } from '../../components/ui';
import { useClasses } from '../../hooks/use-class-structure';
import { adaptHostClass } from '../../lib/class-structure/adapters';
import { classPath, classSessionPath } from '../../lib/class-structure/navigation';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadField, ReadStateView } from '../../components/class/structure/read-state';
import { ClassCreateAction } from '../../components/class/structure/class-create-action';
import { heroBackdrop } from '../../components/class/flow/shell/shell-data';
import { ClassCard, ClassListHeader, NextClassView } from '../../components/class/structure/host-class-views';
function fieldValue<T>(field: DisplayField<T>): T | undefined { return field.kind === 'value' ? field.value : undefined; }
/** 과거·전체 목록은 한 번에 이만큼씩 받고 '더 보기'로 이어 받는다. */
const PAGE_LIMIT = 30;
const pageKey = (status: string | undefined, n: number): string => `${status ?? 'all'}:${n}`;
const SERVER_STATUS_FILTERS = new Set(['draft', 'completed', 'cancelled']);
export function HostClassesPage() {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState<Record<string, ClassSummaryDto[]>>({});
    // 진행·예정(active)은 항상 전부 받는다(열린 회차·다음 수업 히어로의 근거). 수는 적다.
    const { state, retry } = useClasses({ status: 'active' });
    // 그 외(전체·즉석·편성 중·완료·취소)는 최신순 페이지로 받고, 편성 중/완료/취소 탭은 서버 상태 필터를 쓴다.
    const pagedStatus = SERVER_STATUS_FILTERS.has(filter) ? filter : undefined;
    const paged = useClasses({ status: pagedStatus, page, limit: PAGE_LIMIT }, filter !== 'active');
    const pagedRows = paged.state.status === 'success' ? paged.state.data.classes : null;
    useEffect(() => { if (pagedRows) setPages(previous => previous[pageKey(pagedStatus, page)] === pagedRows ? previous : { ...previous, [pageKey(pagedStatus, page)]: pagedRows }); }, [pagedRows, page, pagedStatus]);
    const changeFilter = (value: string) => { setFilter(value); setPage(1); };
    const rows = useMemo(() => {
        const seen = new Set<string>();
        const merged: ClassSummaryDto[] = [];
        const activeRows = state.status === 'success' ? state.data.classes : [];
        const loaded = Array.from({ length: page }, (_, index) => pages[pageKey(pagedStatus, index + 1)] ?? []).flat();
        for (const row of [...activeRows, ...loaded]) if (!seen.has(row.id)) { seen.add(row.id); merged.push(row); }
        return merged;
    }, [state, pages, page, pagedStatus]);
    const pagedTotal = paged.state.status === 'success' ? paged.state.data.total : 0;
    const hasMore = filter !== 'active' && pagedRows !== null && page * PAGE_LIMIT < pagedTotal;
    const models = state.status === 'success' ? rows.map(adaptHostClass) : [];
    const shown = models.filter(model => (filter === 'all' || (filter === 'instant' ? model.is_instant === true : fieldValue(model.status) === filter)) && (fieldValue(model.title) ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const opened = models.filter(model => fieldValue(model.hasOpenSession) === true);
    const nextClass = models.filter(model => { const next = fieldValue(model.nextSession); const at = next && fieldValue(next.scheduledAt); return at && Date.parse(at) >= Date.now(); }).sort((left, right) => { const at = (model: typeof left) => { const next = fieldValue(model.nextSession); return Date.parse(next && fieldValue(next.scheduledAt) || ''); }; return at(left) - at(right); })[0];
    return <StructureShell role="host" title="명상 클래스" rightSlot={<ClassCreateAction />}><Link to="/classes/now" className="mx-auto mb-6 flex max-w-mb-content flex-wrap items-center justify-between gap-6 rounded-3xl bg-purple-900 bg-cover bg-center p-7 text-white" style={{ backgroundImage: 'linear-gradient(100deg,rgba(47,30,70,.8),rgba(74,49,91,.3)),url(/images/background5.webp)' }}><span><strong className="block text-lg">준비 없이 지금 수업을 열어야 하나요?</strong><span className="text-sm">이름·일정 입력 없이 바로 대기실을 열고 코드로 회원을 들여보내요.</span></span><span className={buttonClass({ variant: 'primary', tone: 'inverse', size: 'lg' })}>지금 바로 시작 →</span></Link><ReadStateView status={state.status === 'success' && models.length === 0 ? 'empty' : state.status} onRetry={retry}>
 <div className="mx-auto max-w-mb-content space-y-6 pb-6">{opened.length > 0 && <section aria-label="열려 있는 회차" className="cs-open-hero relative overflow-hidden rounded-[28px] bg-purple-800 p-7 text-white md:p-9" style={{ backgroundImage: `linear-gradient(100deg,rgba(47,30,70,.88),rgba(74,49,91,.45)),url(${heroBackdrop(opened[0].id)})`, backgroundSize: 'cover', backgroundPosition: 'center' }}><p className="mb-2 text-xs mobile:text-mb-caption font-medium tracking-widest text-white/70">지금 함께할 시간</p><h2 className="mb-4 text-2xl font-semibold tracking-tight">열려 있는 회차가 있어요</h2><div className="flex flex-wrap gap-3">{opened.map(model => <Link key={model.id} className={buttonClass({ variant: 'primary', tone: 'inverse', className: 'whitespace-normal' })} to={model.openSessionId ? classSessionPath('host', model.id, model.openSessionId as SessionId) : classPath('host', model.id)}><ReadField value={fieldValue(model.title)}/> · {model.openSessionId ? '회차 보기' : '클래스 보기'}</Link>)}</div></section>}
 {opened.length === 0 && nextClass && <NextClassView model={nextClass} showClassTitle/>}
 <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap gap-2" role="group" aria-label="클래스 상태 필터">{[['all', '전체'], ['instant', '즉석'], ['active', '진행 중'], ['draft', '편성 중'], ['completed', '완료'], ['cancelled', '취소']].map(([value, label]) => <button className={tabClass(filter === value)} type="button" key={value} aria-pressed={filter === value} onClick={() => changeFilter(value)}>{label}</button>)}</div><label className="flex flex-col gap-2 text-xs mobile:text-mb-label text-gray-600">현재 목록에서 찾기<input className={fieldClass()} value={query} onChange={event => setQuery(event.target.value)} placeholder="클래스 이름"/></label></div>
 <p className="text-xs mobile:text-mb-caption text-gray-500">현재 목록 {shown.length}개</p><div className="cs-class-list"><ClassListHeader/>{shown.map(model => <ClassCard key={model.id} model={model}/>)}{shown.length === 0 && <p role="status">검색 결과가 없어요</p>}{hasMore && <button className={buttonClass({ variant: 'secondary', size: 'md' })} type="button" onClick={() => setPage(value => value + 1)}>이전 클래스 더 보기</button>}{paged.state.status === 'error' && <p role="status" className="text-xs text-gray-500">이전 클래스를 불러오지 못했어요. <button type="button" className="underline" onClick={paged.retry}>다시 시도</button></p>}</div></div></ReadStateView></StructureShell>;
}
