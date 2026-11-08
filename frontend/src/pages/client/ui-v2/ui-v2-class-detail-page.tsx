// SDD-318 — 클래스 상세(D안). 개요/회차 탭, 멤버 작업(나가기·대기 등), 입장 링크를 그대로 보존한다.
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import { UiV2ArcRing } from '../../../components/ui-v2/ui-v2-arc-ring';
import { MemberOperations } from '../../../components/class/structure/member-operations';
import { ReadField, ReadStateView } from '../../../components/class/structure/read-state';
import { memberStatus, memberValue } from '../../../components/class/structure/member-class-views';
import { useClassDetail, useMyClassMembership } from '../../../hooks/use-class-structure';
import { membershipApi } from '../../../lib/api/class-operations';
import { useMembershipOperation } from '../../../components/class/structure/membership-operation-state';
import { adaptClassSessions, adaptMemberClass } from '../../../lib/class-structure/adapters';
import { asClassId } from '../../../lib/class-structure/read-model';
import { sessionPath } from '../../../lib/class-structure/navigation';
import { useAuthStore } from '../../../stores/authStore';

type Tab = 'overview' | 'sessions';

function timeOf(iso: string | undefined): string | undefined {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : undefined;
}

/** 시안 하단 "클래스 나가기" 전체 폭 보조 버튼. 나가기 로직(membershipApi.transition)은 MemberOperations 와 동일하다. */
function LeaveButton({ classId }: { classId: string }) {
  const own = useMyClassMembership(classId);
  const data = own.state.status === 'success' ? own.state.data : null;
  const operation = useMembershipOperation(data?.revision);
  if (!data?.capabilities.leave) return null;
  return (
    <div className="u2-leave">
      <button type="button" className="u2-secondary" disabled={operation.busy} onClick={() => void operation.run('transition:leave', (command) => membershipApi.transition(classId, data.member.id, { ...command, action: 'leave' }))}>클래스 나가기</button>
      {operation.error && <p role="alert" className="u2-error">{operation.error}</p>}
      {operation.message && <p role="status" className="u2-footnote">{operation.message}</p>}
    </div>
  );
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(iso: string | undefined): string | undefined {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})` : undefined;
}

function Detail({ classId }: { classId: string }) {
  const { state, retry } = useClassDetail(asClassId(classId));
  const [query] = useSearchParams();
  const selectedId = query.get('sessionId');
  const [tab, setTab] = useState<Tab>('sessions');
  const model = state.status === 'success' ? adaptMemberClass(state.data.detail) : null;
  const sessions = state.status === 'success' ? adaptClassSessions(state.data.sessions.sessions) : [];
  const hasMembership = state.status === 'success' && Boolean(state.data.detail.membership);
  const progress = model ? memberValue(model.progress) : undefined;
  const title = model ? memberValue(model.title) ?? '데이터 없음' : '내 클래스';
  const onKey = (key: Tab) => (event: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: Tab = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'sessions' : key === 'overview' ? 'sessions' : 'overview';
    setTab(next);
    document.getElementById(`u2-${next}-tab`)?.focus();
  };
  return (
    <UiV2ClientShell title={title} back={{ to: '/app/classes', label: '내 클래스로 돌아가기' }}>
      <ReadStateView status={state.status} backTo="/app/classes" onRetry={retry}>
        {model && <>
          <section className="u2-cover">
            <UiV2ArcRing variant="cover" />
            <span className="u2-chip"><ReadField value={memberStatus(model.status)} /></span>
            <h1>{title}</h1>
            {progress && <div className="u2-num">{String(progress.completed).padStart(2, '0')} <span>/ {String(progress.total).padStart(2, '0')}회</span></div>}
            <p className="u2-footnote">클래스 전체 진행이며<br />개인 출석을 의미하지 않아요.</p>
          </section>
          <div role="tablist" aria-label="클래스 정보" className="u2-tabs">
            {(['overview', 'sessions'] as const).map((key) => (
              <button key={key} id={`u2-${key}-tab`} type="button" role="tab" aria-selected={tab === key} aria-controls="u2-class-panel" tabIndex={tab === key ? 0 : -1} onKeyDown={onKey(key)} onClick={() => setTab(key)}>{key === 'overview' ? '개요' : '회차'}</button>
            ))}
          </div>
          <div role="tabpanel" id="u2-class-panel" aria-labelledby={`u2-${tab}-tab`} tabIndex={0}>
            {tab === 'overview' ? (
              <section className="u2-card"><h3>클래스 개요</h3>
                <dl className="u2-facts">
                  <div><dt>진행 방식</dt><dd><ReadField value={memberValue(model.locationType) === 'online' ? '온라인' : memberValue(model.locationType) === 'offline' ? '대면' : undefined} /></dd></div>
                  <div><dt>장소</dt><dd><ReadField value={memberValue(model.locationAddress)} /></dd></div>
                  <div><dt>정원</dt><dd><ReadField value={memberValue(model.capacity)} /></dd></div>
                  <div><dt>회차 길이</dt><dd><ReadField value={memberValue(model.defaultDurationMin) == null ? undefined : `${memberValue(model.defaultDurationMin)}분`} /></dd></div>
                  <div><dt>LINK BAND</dt><dd><ReadField value={memberValue(model.linkbandMode) === 'none' ? '사용 안 함' : memberValue(model.linkbandMode) === 'optional' ? '선택' : memberValue(model.linkbandMode) === 'required' ? '사용' : undefined} /></dd></div>
                  <div><dt>음성 녹음</dt><dd><ReadField value={memberValue(model.recordAudio)} /></dd></div>
                </dl>
              </section>
            ) : (
              <section aria-label="회차">
                {sessions.length === 0 ? <p className="u2-card u2-muted">아직 회차가 없어요</p> : (
                  <ol className="u2-timeline">
                    {sessions.map((session) => {
                      const seq = memberValue(session.seq);
                      const st = memberValue(session.status);
                      const at = memberValue(session.scheduledAt);
                      const upcomingState = st !== 'completed' && st !== 'cancelled';
                      const enterable = st === 'open' || st === 'in_progress';
                      return (
                        <li key={session.id} data-session-id={session.id} data-selected={selectedId === session.id} aria-current={selectedId === session.id ? 'true' : undefined}>
                          <div className="u2-card">
                            <Link to={sessionPath('member', session.id, { area: 'meditation', classId: model.id })} style={{ display: 'block' }}>
                              <div className="u2-row"><span className="u2-eyebrow">{seq == null ? '회차' : `${String(seq).padStart(2, '0')}회차`}</span><span className="u2-chip"><ReadField value={memberStatus(session.status)} /></span></div>
                              {upcomingState && timeOf(at) && <div className="u2-num u2-num--small u2-gap">{timeOf(at)}</div>}
                              <h3 className="u2-gap-sm">{dayLabel(at) ?? '일정 확인 중'}</h3>
                              <p className="u2-muted">{!upcomingState && timeOf(at) ? `${timeOf(at)} · ` : ''}지도사 <ReadField value={memberValue(session.hostName)} /></p>
                              <span className="u2-textlink" aria-hidden="true">회차 상세 ›</span>
                            </Link>
                            {enterable && <Link className="u2-primary u2-gap" to={`/class/${encodeURIComponent(session.id)}/enter`}>입장하기</Link>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            )}
          </div>
          {hasMembership && <>
            <details className="u2-ops">
              <summary><span>내 참여와 동의</span><span className="u2-setchev" aria-hidden="true">›</span></summary>
              <div className="u2-ops-body"><MemberOperations classId={classId} /></div>
            </details>
            <LeaveButton classId={classId} />
          </>}
        </>}
      </ReadStateView>
    </UiV2ClientShell>
  );
}

export function UiV2ClassDetailPage() {
  const user = useAuthStore((s) => s.user);
  const { classId } = useParams<{ classId: string }>();
  if (!classId?.trim()) return <UiV2ClientShell title="내 클래스" back={{ to: '/app/classes', label: '내 클래스로 돌아가기' }}><ReadStateView status="not_found" backTo="/app/classes" /></UiV2ClientShell>;
  return <Detail key={`${classId}:${user?.id}:${user?.role}`} classId={classId} />;
}
