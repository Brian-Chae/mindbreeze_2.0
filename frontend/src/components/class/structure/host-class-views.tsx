import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { HostClassReadModel, SessionReadModel } from '../../../lib/class-structure/adapters';
import type { DisplayField, ClassId } from '../../../lib/class-structure/read-model';
import { classPath, classSessionPath } from '../../../lib/class-structure/navigation';
import { ReadField } from './read-state';
function fieldValue<T>(field: DisplayField<T>): T | undefined { return field.kind === 'value' ? field.value : undefined; }
const labels: Record<string, string> = { active: '진행 중', ready: '준비', draft: '편성 중', completed: '완료', cancelled: '취소', scheduled: '예정', waiting: '대기 중', in_progress: '진행 중', open: '입장 중', fixed: '고정형', rolling: '정기형', online: '온라인', offline: '오프라인', hybrid: '온·오프라인', optional: '선택', required: '필수', none: '사용 안 함', regular: '정규', makeup: '보강' };
export function LabelField({ field }: {
    field: DisplayField<string>;
}) { const value = fieldValue(field); return <ReadField value={value === undefined ? undefined : labels[value]}/>; }
export function DateField({ field }: {
    field: DisplayField<string>;
}) { const value = fieldValue(field); return <ReadField value={value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : undefined}/>; }
export function ProgressView({ model }: {
    model: HostClassReadModel;
}) {
    const value = fieldValue(model.progress);
    return <div aria-label="클래스 진행"><span className="text-xs text-gray-500">클래스 진행</span><p className="font-semibold"><ReadField value={value ? `${value.completed}/${value.total}` : undefined}/></p>{value && value.total > 0 && value.completed >= 0 && value.completed <= value.total && <progress className="w-full accent-purple-700" value={value.completed} max={value.total} aria-label="완료 회차 비율"/>}</div>;
}
export function ClassCard({ model }: {
    model: HostClassReadModel;
}) {
    const next = fieldValue(model.nextSession);
    return <Link data-class-card to={classPath('host', model.id)} className="grid min-w-0 gap-4 rounded-2xl border border-gray-200 bg-white p-5 md:grid-cols-4">
 <div className="min-w-0 break-words"><h2 className="font-semibold"><ReadField value={fieldValue(model.title)}/></h2><LabelField field={model.scheduleMode}/><p className="mt-2 text-xs text-purple-700"><LabelField field={model.status}/></p></div>
 <div><span className="text-xs text-gray-500">다음 회차</span><p>{next ? <DateField field={next.scheduledAt}/> : <ReadField />}</p></div>
 <ProgressView model={model}/><div><span className="text-xs text-gray-500">진행 지도사</span><p><ReadField value={next ? fieldValue(next.hostName) : undefined}/></p></div></Link>;
}
export function NextClassView({ model }: {
    model: HostClassReadModel;
}) {
    const next = fieldValue(model.nextSession);
    return <section className="rounded-2xl bg-purple-50 p-6" aria-label="다음 회차"><h2 className="mb-3 font-semibold">다음 회차</h2>{next ? <><p>{fieldValue(next.seq) === undefined ? <ReadField /> : `${fieldValue(next.seq)}회차`}</p><p><DateField field={next.scheduledAt}/></p><p className="my-3">지도사 <ReadField value={fieldValue(next.hostName)}/></p><Link className="inline-flex items-center rounded-xl bg-white px-4 py-2 text-purple-800" to={classSessionPath('host', model.id, next.id)}>회차 보기</Link></> : <ReadField />}</section>;
}
export function HostSessionViews({ classId, sessions }: { classId: ClassId; sessions: SessionReadModel[] }) {
    const [timeline, setTimeline] = useState(false);
    const number = (session: SessionReadModel) => fieldValue(session.seq) === undefined ? <ReadField/> : `${fieldValue(session.seq)}회차`;
    const status = (session: SessionReadModel) => <><LabelField field={session.status}/>{fieldValue(session.sessionKind) === 'makeup' && ' · 보강'}</>;
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
