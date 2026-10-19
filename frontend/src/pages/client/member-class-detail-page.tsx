import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useClassDetail } from '../../hooks/use-class-structure';
import { adaptMemberClass, adaptClassSessions } from '../../lib/class-structure/adapters';
import { asClassId } from '../../lib/class-structure/read-model';
import { sessionPath } from '../../lib/class-structure/navigation';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadField, ReadStateView } from '../../components/class/structure/read-state';
import { MemberClassStyles, MemberProgress, MemberSessionMeta, memberStatus, memberValue } from '../../components/class/structure/member-class-views';

function MemberClassDetail({ classId }: { classId: string }) {
  const { state, retry } = useClassDetail(asClassId(classId));
  const [query] = useSearchParams();
  const selectedId = query.get('sessionId');
  const [tab, setTab] = useState<'overview' | 'sessions'>('sessions');
  const model = state.status === 'success' ? adaptMemberClass(state.data.detail) : null;
  const sessions = state.status === 'success' ? adaptClassSessions(state.data.sessions.sessions) : [];
  return <StructureShell role="member" title={model ? memberValue(model.title) ?? '데이터 없음' : '내 클래스'}><MemberClassStyles /><div className="mc-stack">
    <ReadStateView status={state.status} backTo="/app/classes" onRetry={retry}>
      {model && <>
        <Link className="mc-link" to="/app/classes">내 클래스로 돌아가기</Link>
        <section className="mc-card"><span className="mc-chip"><ReadField value={memberStatus(model.status)} /></span><h2><ReadField value={memberValue(model.title)} /></h2><MemberProgress model={model} /><p className="mc-muted">클래스 전체 진행이며 개인 출석을 의미하지 않아요.</p></section>
        <div role="tablist" aria-label="클래스 정보" className="mc-row">{(['overview', 'sessions'] as const).map((key) => <button key={key} id={`member-${key}-tab`} type="button" role="tab" className="mc-link" aria-selected={tab === key} aria-controls="member-class-panel" tabIndex={tab === key ? 0 : -1} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const nextTab = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'sessions' : key === 'overview' ? 'sessions' : 'overview';
          setTab(nextTab);
          document.getElementById(`member-${nextTab}-tab`)?.focus();
        }} onClick={() => setTab(key)}>{key === 'overview' ? '개요' : '회차'}</button>)}</div>
        <div role="tabpanel" id="member-class-panel" aria-labelledby={`member-${tab}-tab`} tabIndex={0}>
          {tab === 'overview' ? <section className="mc-card"><h2>클래스 개요</h2><dl className="mc-facts">
            <div><dt>진행 방식</dt><dd><ReadField value={memberValue(model.locationType) === 'online' ? '온라인' : memberValue(model.locationType) === 'offline' ? '대면' : undefined} /></dd></div>
            <div><dt>장소</dt><dd><ReadField value={memberValue(model.locationAddress)} /></dd></div>
            <div><dt>정원</dt><dd><ReadField value={memberValue(model.capacity)} /></dd></div>
            <div><dt>회차 길이</dt><dd><ReadField value={memberValue(model.defaultDurationMin) == null ? undefined : `${memberValue(model.defaultDurationMin)}분`} /></dd></div>
            <div><dt>LINK BAND</dt><dd><ReadField value={memberValue(model.linkbandMode) === 'none' ? '사용 안 함' : memberValue(model.linkbandMode) === 'optional' ? '선택' : memberValue(model.linkbandMode) === 'required' ? '사용' : undefined} /></dd></div>
            <div><dt>음성 녹음</dt><dd><ReadField value={memberValue(model.recordAudio)} /></dd></div>
          </dl></section> : <section aria-label="회차"><h2 className="mc-heading">회차</h2>{sessions.length === 0 ? <p className="mc-card mc-muted">아직 회차가 없어요</p> : <ol className="mc-timeline">{sessions.map((session) => <li key={session.id} className={`mc-card${selectedId === session.id ? ' mc-selected' : ''}`} data-session-id={session.id} aria-current={selectedId === session.id ? 'true' : undefined}>
            <Link className="mc-card-link" to={sessionPath('member', session.id, { area: 'meditation', classId: model.id })}><div className="mc-row"><h3><ReadField value={memberValue(session.seq) == null ? undefined : `${memberValue(session.seq)}회차`} /></h3><span className="mc-chip"><ReadField value={memberStatus(session.status)} /></span></div><MemberSessionMeta session={session} /></Link>
            {(memberValue(session.status) === 'open' || memberValue(session.status) === 'in_progress') && <Link className="mc-link" to={`/class/${encodeURIComponent(session.id)}/enter`}>입장하기</Link>}
          </li>)}</ol>}</section>}
        </div>
      </>}
    </ReadStateView>
  </div></StructureShell>;
}
export function MemberClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  if (!classId?.trim()) return <StructureShell role="member" title="내 클래스"><ReadStateView status="not_found" backTo="/app/classes" /></StructureShell>;
  return <MemberClassDetail key={classId} classId={classId} />;
}
