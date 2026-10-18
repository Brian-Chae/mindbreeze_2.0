import type { DisplayField } from '../../lib/class-structure/read-model';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClasses } from '../../hooks/use-class-structure';
import { adaptHostClass } from '../../lib/class-structure/adapters';
import { classPath } from '../../lib/class-structure/navigation';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadField, ReadStateView } from '../../components/class/structure/read-state';
import { ClassCard } from '../../components/class/structure/host-class-views';
function fieldValue<T>(field: DisplayField<T>): T | undefined { return field.kind === 'value' ? field.value : undefined; }
export function HostClassesPage() {
    const { state, retry } = useClasses();
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const models = state.status === 'success' ? state.data.classes.map(adaptHostClass) : [];
    const shown = models.filter(model => (filter === 'all' || fieldValue(model.status) === filter) && (fieldValue(model.title) ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const opened = models.filter(model => fieldValue(model.hasOpenSession) === true);
    return <StructureShell role="host" title="명상 클래스" rightSlot={<Link className="inline-flex items-center rounded-xl bg-purple-800 px-4 py-2 text-white" to="/classes/new">새 클래스 만들기</Link>}><ReadStateView status={state.status === 'success' && models.length === 0 ? 'empty' : state.status} onRetry={retry}>
 <div className="mx-auto max-w-6xl space-y-6 pb-6">{opened.length > 0 && <section aria-label="열려 있는 회차" className="rounded-2xl bg-purple-800 p-6 text-white"><h2 className="mb-3 text-lg font-semibold">열려 있는 회차가 있어요</h2><div className="flex flex-wrap gap-3">{opened.map(model => <Link key={model.id} className="inline-flex items-center rounded-xl bg-white px-4 py-2 text-purple-800" to={classPath('host', model.id)}><ReadField value={fieldValue(model.title)}/> · 클래스 보기</Link>)}</div></section>}
 <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap gap-2" role="group" aria-label="클래스 상태 필터">{[['all', '전체'], ['active', '진행 중'], ['draft', '편성 중'], ['completed', '완료'], ['cancelled', '취소']].map(([value, label]) => <button className="rounded-xl border border-gray-200 bg-white px-4 py-2 aria-pressed:bg-purple-800 aria-pressed:text-white" type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="flex flex-col gap-2 text-xs text-gray-600">현재 목록에서 찾기<input className="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-4 text-sm" value={query} onChange={event => setQuery(event.target.value)} placeholder="클래스 이름"/></label></div>
 <p className="text-xs text-gray-500">현재 목록 {shown.length}개</p><div className="space-y-3">{shown.map(model => <ClassCard key={model.id} model={model}/>)}{shown.length === 0 && <p role="status">검색 결과가 없어요</p>}</div></div></ReadStateView></StructureShell>;
}
