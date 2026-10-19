import { ClassScheduleEditor } from '../../components/class/structure/class-schedule-editor';
import { ClassMembersPanel } from '../../components/class/structure/class-members-panel';
import { ClassSettingsPanel } from '../../components/class/structure/class-settings-panel';
import type { DisplayField } from '../../lib/class-structure/read-model';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useClassDetail } from '../../hooks/use-class-structure';
import { adaptHostClass, adaptClassSessions } from '../../lib/class-structure/adapters';
import { asClassId } from '../../lib/class-structure/read-model';
import { classPath } from '../../lib/class-structure/navigation';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadField, ReadStateView } from '../../components/class/structure/read-state';
import { HostSessionViews, LabelField, NextClassView, ProgressView } from '../../components/class/structure/host-class-views';
function fieldValue<T>(field: DisplayField<T>): T | undefined { return field.kind === 'value' ? field.value : undefined; }
export function HostClassDetailPage() {
    const { classId } = useParams<{
        classId: string;
    }>();
    return classId?.trim() ? <HostClassDetailContent classId={classId}/> : <StructureShell role="host" title="명상 클래스"><ReadStateView status="not_found" backTo="/classes"/></StructureShell>;
}
function HostClassDetailContent({ classId }: {
    classId: string;
}) {
    const id = asClassId(classId);
    const { state, retry } = useClassDetail(id);
    const location = useLocation();
    const model = state.status === 'success' ? adaptHostClass(state.data.detail) : null;
    const sessions = state.status === 'success' ? adaptClassSessions(state.data.sessions.sessions) : [];
    const base = classPath('host', id);
    const detail = state.status === 'success' ? state.data.detail : null;
    const tab = new URLSearchParams(location.search).get('tab');
    const isMembers = tab === 'members' && detail?.capabilities?.invite === true;
    const isSettings = tab === 'settings' && detail?.capabilities?.schedule === true;
    const isSessions = location.pathname === `${base}/sessions` || location.pathname === `${base}/sessions/`;
    return <StructureShell role="host" title={model ? fieldValue(model.title) ?? '데이터 없음' : '명상 클래스'} rightSlot={<Link className="inline-flex items-center rounded-xl bg-white px-4 py-2" to="/classes">클래스 목록</Link>}><ReadStateView status={state.status} onRetry={retry} backTo="/classes">{model && <div className="mx-auto max-w-6xl space-y-6 pb-6"><nav aria-label="클래스 메뉴" className="flex flex-wrap gap-2 border-b border-gray-200">{[['', '개요', !isSessions&&!isMembers&&!isSettings], ['/sessions', '회차', isSessions], ...(detail?.capabilities?.invite ? [['?tab=members','멤버',isMembers]] : []), ...(detail?.capabilities?.schedule ? [['?tab=settings','설정',isSettings]] : [])].map(([suffix, label, selected]) => <Link key={String(label)} className={`inline-flex items-center border-b-2 px-4 py-3 ${selected ? 'border-purple-800 font-semibold text-purple-800' : 'border-transparent text-gray-500'}`} aria-current={selected ? 'page' : undefined} to={`${base}${suffix}`}>{label}</Link>)}</nav>{detail?.capabilities?.schedule&&<div className="flex flex-wrap gap-3">{detail.status==='draft'?<Link className="rounded-xl bg-purple-800 px-4 py-2 text-white" to={`/classes/new?draft=${encodeURIComponent(detail.id)}`}>편성 이어쓰기</Link>:<Link className="rounded-xl border bg-white px-4 py-2" to={`/classes/new?copy=${encodeURIComponent(detail.id)}`}>지난 기수로 새 클래스 만들기</Link>}</div>}{isMembers && detail ? <ClassMembersPanel key={detail.id} detail={detail} onSaved={retry}/> : isSettings && detail ? <ClassSettingsPanel key={detail.id} detail={detail} onSaved={retry}/> : isSessions ? <><HostSessionViews classId={id} sessions={sessions}/>{detail?.capabilities?.schedule&&state.status==='success'&&<ClassScheduleEditor detail={detail} sessions={state.data.sessions.sessions} onSaved={retry}/>}</> : <><NextClassView model={model}/><div className="grid gap-6 md:grid-cols-2"><section className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5"><h2 className="font-semibold">클래스 개요</h2><div>클래스 상태<LabelField field={model.status}/></div><ProgressView model={model}/><p className="text-xs text-gray-500">회차 진행과 클래스 상태는 별도로 표시해요.</p></section><section className="rounded-2xl border border-gray-200 bg-white p-5"><h2 className="mb-5 font-semibold">기본 정보</h2><dl className="space-y-4">{[
                    ['클래스 코드', <ReadField value={model.hostView ? fieldValue(model.hostView.accessCode) : undefined}/>], ['일정 형태', <LabelField field={model.scheduleMode}/>], ['방식', <LabelField field={model.locationType}/>], ['장소', <ReadField value={fieldValue(model.locationAddress)}/>], ['정원', <ReadField value={fieldValue(model.capacity)}/>], ['진행 시간(분)', <ReadField value={fieldValue(model.defaultDurationMin)}/>], ['음성 녹음', <ReadField value={fieldValue(model.recordAudio)}/>], ['LINK BAND', <LabelField field={model.linkbandMode}/>], ['지도사', model.hostView?.instructors.length ? model.hostView.instructors.map(instructor => <p key={instructor.userId}><ReadField value={fieldValue(instructor.name)}/></p>) : <ReadField />],
                ].map(([label, value], index) => <div key={index} className="grid grid-cols-2 gap-4"><dt className="text-gray-500">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}</dl></section></div></>}</div>}</ReadStateView></StructureShell>;
}
