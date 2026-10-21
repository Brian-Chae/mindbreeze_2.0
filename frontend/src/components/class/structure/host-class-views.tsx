import { useState } from 'react';
import { ArrowUpRight, CalendarDays, Leaf, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { HostClassReadModel, SessionReadModel } from '../../../lib/class-structure/adapters';
import type { DisplayField, ClassId } from '../../../lib/class-structure/read-model';
import { classPath, classSessionPath } from '../../../lib/class-structure/navigation';
import { ReadField } from './read-state';
function fieldValue<T>(field: DisplayField<T>): T | undefined { return field.kind === 'value' ? field.value : undefined; }
const labels: Record<string, string> = { active: '진행 중', ready: '준비', draft: '편성 중', completed: '완료', cancelled: '취소', scheduled: '예정', waiting: '대기 중', in_progress: '진행 중', open: '입장 중', fixed: '고정형', rolling: '정기형', online: '온라인', offline: '오프라인', hybrid: '온·오프라인', optional: '선택', required: '필수', none: '사용 안 함', regular: '정규', makeup: '보강', assigned: '배정 완료', pending_ack: '수락 대기', needs_reassign: '재배정 필요' };
export function LabelField({ field }: {
    field: DisplayField<string>;
}) { const value = fieldValue(field); return <ReadField value={value === undefined ? undefined : labels[value]}/>; }
export function DateField({ field }: {
    field: DisplayField<string>;
}) { const value = fieldValue(field); return <ReadField value={value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : undefined}/>; }
export function ProgressView({ model }: { model: HostClassReadModel }) {
    const value = fieldValue(model.progress);
    const next = fieldValue(model.nextSession);
    const seq = next ? fieldValue(next.seq) : undefined;
    if (fieldValue(model.scheduleMode) === 'rolling') return <div className="cs-class-progress" aria-label="클래스 진행"><span className="cs-class-key">진행</span><strong>{seq == null ? '정기형' : `${seq}회차째`}</strong><small>{seq == null ? '전체 횟수 없이 이어져요' : '다음 회차 · 정기형'}</small></div>;
    return <div className="cs-class-progress" aria-label="클래스 진행"><span className="cs-class-key">클래스 진행</span><div className="cs-progress-line">{value && value.total > 0 && value.completed >= 0 && value.completed <= value.total && <progress value={value.completed} max={value.total} aria-label="완료 회차 비율"/>}<strong><ReadField value={value ? `${value.completed}/${value.total}` : undefined}/></strong></div></div>;
}
export function ClassListHeader() {
    return <div className="cs-class-columns" aria-hidden="true">{['클래스', '다음 회차', '진행', '진행 지도사', '상태'].map(label => <span data-class-column key={label}>{label}</span>)}</div>;
}
export function ClassCard({ model }: { model: HostClassReadModel }) {
    const next = fieldValue(model.nextSession);
    const status = fieldValue(model.status);
    const mode = fieldValue(model.scheduleMode);
    const count = fieldValue(model.plannedSessionCount);
    return <div className="relative"><Link data-class-card to={classPath('host', model.id)} className="cs-class-row">
        <div className="cs-class-identity"><span className="cs-class-icon"><Leaf size={24} aria-hidden="true"/></span><div><h2><ReadField value={fieldValue(model.title)}/>{model.is_instant && <span className="ml-2 rounded-full bg-purple-100 px-2 py-1 text-xs font-medium text-purple-800">즉석</span>}</h2><p><LabelField field={model.scheduleMode}/>{mode === 'fixed' && count != null ? ` ${count}회` : ''}</p></div></div>
        <div className="cs-class-next"><span className="cs-class-key">다음 회차</span>{next ? <><strong>{fieldValue(next.seq) == null ? '다음 일정' : `${fieldValue(next.seq)}회차`}</strong><small><DateField field={next.scheduledAt}/></small></> : <strong>{status === 'completed' ? '모두 마쳤어요' : status === 'draft' ? '아직 공개 전' : '다음 일정 없음'}</strong>}</div>
        <ProgressView model={model}/>
        <div className="cs-class-host"><span className="cs-class-key">진행 지도사</span><strong><ReadField value={next ? fieldValue(next.hostName) : undefined}/></strong>{next && fieldValue(next.hostName) === undefined && <small>진행 지도사를 확인해 주세요</small>}</div>
        <div className="cs-class-state"><span className={`cs-state-chip ${status === 'completed' || status === 'cancelled' || status === 'draft' ? 'cs-muted-chip' : ''}`}><LabelField field={model.status}/></span>{fieldValue(model.hasOpenSession) === true && <span className="cs-state-chip cs-open-chip">열려 있는 회차</span>}</div>
    </Link>{model.is_instant && status === 'completed' && <Link className="mb-3 inline-flex min-h-11 items-center rounded-xl border border-purple-200 px-4 text-sm font-semibold text-purple-800" to={`/classes/now?from=${encodeURIComponent(model.id)}`}>다시 열기</Link>}</div>;
}
export function NextClassView({ model, showClassTitle = false }: { model: HostClassReadModel; showClassTitle?: boolean }) {
    const next = fieldValue(model.nextSession);
    const seq = next ? fieldValue(next.seq) : undefined;
    const status = fieldValue(model.status);
    const duration = fieldValue(model.defaultDurationMin);
    const location = fieldValue(model.locationType);
    return <section className="cs-class-hero" aria-label="다음 회차" style={{ backgroundImage: 'url(/images/background8.webp)' }}>
        <div className="cs-hero-main"><div className="cs-hero-top"><span className="cs-hero-chip"><CalendarDays size={16} aria-hidden="true"/>{next ? <LabelField field={next.status}/> : <LabelField field={model.status}/>}</span><span>다음 회차</span></div>
        <h2>{showClassTitle && <><ReadField value={fieldValue(model.title)}/> · </>}{next ? seq == null ? '예정된 회차' : `${seq}회차` : status === 'draft' ? '편성을 이어서 완성해요' : status === 'completed' ? '모든 회차를 마쳤어요' : status === 'cancelled' ? '취소된 클래스예요' : '다음 회차가 없어요'}</h2>
        {next && <><p className="cs-hero-when"><CalendarDays size={18} aria-hidden="true"/><DateField field={next.scheduledAt}/>{duration != null && ` · ${duration}분`}</p><div className="cs-hero-chips">{location && <span className="cs-hero-chip"><LabelField field={model.locationType}/></span>}<span className="cs-hero-chip"><LabelField field={model.scheduleMode}/></span>{fieldValue(model.linkbandMode) === 'optional' && <span className="cs-hero-chip">LINK BAND 선택</span>}</div><div className="cs-hero-guide"><UserRound size={20} aria-hidden="true"/><div><strong>지도사 <ReadField value={fieldValue(next.hostName)}/></strong><p>진행 지도사가 회차를 열고 시작해요.</p></div></div></>}
        </div>
        {next && <div className="cs-hero-actions" data-hero-actions><Link to={classSessionPath('host', model.id, next.id)}>회차 보기<ArrowUpRight size={20} aria-hidden="true"/></Link><p>일정과 진행 상태를 확인해요.</p></div>}
    </section>;
}
export function HostSessionViews({ classId, sessions }: { classId: ClassId; sessions: SessionReadModel[] }) {
    const [timeline, setTimeline] = useState(false);
    const number = (session: SessionReadModel) => fieldValue(session.seq) === undefined ? <ReadField/> : `${fieldValue(session.seq)}회차`;
    const status = (session: SessionReadModel) => <><LabelField field={session.status}/>{fieldValue(session.sessionKind) === 'makeup' && ' · 보강'}{['needs_reassign','pending_ack'].includes(fieldValue(session.hostState)??'')&&<span className="ml-2 rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-900"><LabelField field={session.hostState}/></span>}</>;
    return (
        <section>
            <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="회차 보기 방식">
                {['표로 보기', '타임라인'].map((label, index) => (
                    <button key={label} type="button" aria-pressed={timeline === Boolean(index)}
                        onClick={() => setTimeline(Boolean(index))}
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 aria-pressed:bg-purple-800 aria-pressed:text-white">{label}</button>
                ))}
            </div>
            {sessions.length === 0 ? <p role="status">아직 회차가 없어요</p> : timeline ? (
                <ol className="space-y-4 border-l border-purple-200 pl-4">
                    {sessions.map(session => (
                        <li className="rounded-2xl border border-gray-200 bg-white" key={session.id}>
                            <Link className="grid gap-3 p-5 md:grid-cols-4" to={classSessionPath('host', classId, session.id)}>
                                <strong>{number(session)}</strong><span><DateField field={session.scheduledAt}/></span>
                                <span>지도사 <ReadField value={fieldValue(session.hostName)}/></span><span>{status(session)}</span>
                            </Link>
                        </li>
                    ))}
                </ol>
            ) : (
                <div role="table" aria-label="회차 목록" className="rounded-2xl border border-gray-200 bg-white">
                    <div role="row" className="sr-only md:not-sr-only md:grid md:grid-cols-4 md:gap-3 md:p-5">
                        {['회차', '일시', '진행 지도사', '상태'].map(label => <div role="columnheader" key={label} className="text-xs text-gray-500">{label}</div>)}
                    </div>
                    {sessions.map(session => (
                        <div role="row" className="grid gap-3 border-b border-gray-100 p-5 last:border-0 md:grid-cols-4" key={session.id}>
                            <div role="cell"><Link className="inline-flex items-center font-semibold text-purple-800" to={classSessionPath('host', classId, session.id)}>{number(session)}</Link></div>
                            <div role="cell"><DateField field={session.scheduledAt}/></div>
                            <div role="cell"><ReadField value={fieldValue(session.hostName)}/></div>
                            <div role="cell">{status(session)}</div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
