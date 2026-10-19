import { useEffect, useRef, useState } from 'react';
import type { ClassDetailDto, ClassSessionDto } from '../../../lib/api/class-structure';
import { schedulingApi, type ScheduleRow, type SchedulePreview } from '../../../lib/api/class-scheduling';
import { ApiError, apiClient } from '../../../lib/api/client';
import { operationKeys, schedulingError } from '../../../lib/class-structure/scheduling-model';
import { useAuthStore } from '../../../stores/authStore';

interface Props { detail: ClassDetailDto; sessions: ClassSessionDto[]; onSaved: () => void }
interface Member { id: string; user_id: string | null; name: string | null; status: string }
export function ClassSessionAdd({ detail, sessions, onSaved }: Props) {
  const administrator = useAuthStore(state => state.user?.role === 'org_admin');
  const [kind, setKind] = useState<'regular' | 'makeup' | null>(null);
  const sources = sessions.filter(session => session.session_kind === 'regular' && ['completed', 'cancelled'].includes(session.status));
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersReady, setMembersReady] = useState(false);
  const [row, setRow] = useState<ScheduleRow>(() => ({
    client_key: `additional:${crypto.randomUUID()}`, seq: Math.max(0, ...sessions.map(session => session.seq ?? 0)) + 1,
    scheduled_at: `${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + 86400000))}T19:00:00+09:00`,
    duration_min: detail.default_duration_min ?? 60, location_type: detail.location_type === 'offline' ? 'offline' : 'online',
    location_address: detail.location_address, host_id: detail.host_view?.instructors.find(person => person.status === 'active' && person.role === 'lead')?.user_id ?? null,
    session_kind: 'regular', assignment_override: true,
  }));
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<{ conflicts: SchedulePreview['conflicts']; fingerprint: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const locked = useRef(false); const alive = useRef(true); const keyFor = useRef(operationKeys());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (kind !== 'makeup') return;
    let active = true; setMembersReady(false);
    apiClient.get<{ members: Member[] }>(`/classes/${encodeURIComponent(detail.id)}/members`).then(result => {
      if (active) { setMembers(result.members.filter(member => member.user_id && (member.status === 'active' || detail.status === 'completed' && member.status === 'completed'))); setMembersReady(true); }
    }).catch(() => { if (active) setError('보강 대상 회원을 불러오지 못했어요. 닫은 뒤 다시 시도해 주세요.'); });
    return () => { active = false; };
  }, [kind, detail.id, detail.status]);
  function clearConflict() { setConflicts(null); setConfirmed(false); setError(''); }
  function patch(next: Partial<ScheduleRow>) { setRow(previous => ({ ...previous, ...next })); clearConflict(); }
  async function save() {
    if (locked.current || !kind) return;
    if (kind === 'makeup' && (!sourceId || !membersReady || !memberIds.length)) { setError('원 회차와 보강 대상 회원을 선택해 주세요.'); return; }
    if (!row.host_id || new Date(row.scheduled_at).getTime() <= Date.now() || row.duration_min < 5 || row.duration_min > 480 || row.duration_min % 5 || row.location_type === 'offline' && !row.location_address?.trim()) { setError('미래 일시·진행 지도사·소요 시간·장소를 확인해 주세요.'); return; }
    if (administrator && !reason.trim()) { setError('센터 관리자 대행 사유를 입력해 주세요.'); return; }
    if (conflicts?.conflicts.some(item => item.kind !== 'place') && !confirmed) { setError('겹치는 일정을 확인해 주세요.'); return; }
    const body = { expected_revision: detail.revision, row: { ...row, session_kind: kind }, member_ids: kind === 'makeup' ? memberIds : [], ...(kind === 'makeup' ? { makeup_for_session_id: sourceId } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}), ...(confirmed && conflicts ? { force: true, confirmed_conflict_fingerprint: conflicts.fingerprint } : {}) };
    locked.current = true; setBusy(true); setError('');
    try { await schedulingApi.addSession(detail.id, { ...body, operation_key: keyFor.current(body) }); if (alive.current) { setKind(null); onSaved(); } }
    catch (error) {
      if (alive.current) {
        setError(schedulingError(error)); setConfirmed(false);
        if (error instanceof ApiError) {
          const data = (error.data as { detail?: { code?: string; conflicts?: SchedulePreview['conflicts']; conflict_fingerprint?: string } } | null)?.detail;
          if (data?.code === 'schedule_conflict' && Array.isArray(data.conflicts) && data.conflict_fingerprint) setConflicts({ conflicts: data.conflicts, fingerprint: data.conflict_fingerprint });
        }
      }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="ce-add" aria-label="회차 추가"><div className="ce-toolbar"><button disabled={busy} onClick={() => { setKind('regular'); clearConflict(); }}>정규 회차 추가</button><button disabled={busy || !sources.length} onClick={() => { setKind('makeup'); clearConflict(); }}>보강 추가</button></div>{kind && <div className="ce-add-form"><h3>{kind === 'makeup' ? '보강 회차를 추가해요' : '정규 회차를 추가해요'}</h3><fieldset disabled={busy}><div className="ce-add-grid"><label>일시<input type="datetime-local" step={300} value={new Date(new Date(row.scheduled_at).getTime() + 9 * 3600000).toISOString().slice(0, 16)} onChange={e => { if (e.target.value) patch({ scheduled_at: `${e.target.value}:00+09:00` }); }} /></label><label>소요 시간(분)<input type="number" min={5} max={480} step={5} value={row.duration_min} onChange={e => patch({ duration_min: Number(e.target.value) })} /></label><label>진행 지도사<select value={row.host_id ?? ''} onChange={e => patch({ host_id: e.target.value || null })}><option value="">선택해 주세요</option>{detail.host_view?.instructors.filter(person => person.status === 'active').map(person => <option key={person.user_id} value={person.user_id}>{person.name ?? '이름 없음'}</option>)}</select></label><label>진행 방식<select value={row.location_type} onChange={e => patch({ location_type: e.target.value as 'online' | 'offline' })}><option value="online">온라인</option><option value="offline" disabled={detail.record_video === true}>오프라인</option></select></label>{row.location_type === 'offline' && <label>장소<input value={row.location_address ?? ''} onChange={e => patch({ location_address: e.target.value })} /></label>}</div>{kind === 'makeup' && <><label>원래 정규 회차<select value={sourceId} onChange={e => { setSourceId(e.target.value); clearConflict(); }}>{sources.map(session => <option key={session.id} value={session.id}>{session.seq}회차 · {session.status === 'completed' ? '완료' : '취소'}</option>)}</select></label><h4>보강 대상 회원</h4>{!membersReady && <p>회원을 불러오는 중이에요.</p>}{members.map(member => <label className="ce-add-member" key={member.id}><input type="checkbox" aria-label={`${member.name ?? '이름 확인 필요'} 선택`} checked={memberIds.includes(member.user_id!)} onChange={() => { setMemberIds(previous => previous.includes(member.user_id!) ? previous.filter(id => id !== member.user_id) : [...previous, member.user_id!]); clearConflict(); }} />{member.name ?? '이름 확인 필요'}</label>)}<p>선택한 회원만 보강 대상이 돼요. 정규 회차의 진행률 분모는 늘어나지 않아요.</p></>}{administrator && <label>센터 관리자 대행 사유<textarea maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); clearConflict(); }} /></label>}</fieldset>{conflicts && <div className="ce-preview"><h4>겹치는 일정을 확인해 주세요</h4>{conflicts.conflicts.map((conflict, index) => <p key={index}>{conflict.visible && conflict.parent_title ? conflict.parent_title : '다른 일정'} · {conflict.kind === 'host' ? '지도사' : conflict.kind === 'member' ? '회원' : '장소'}</p>)}<label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />확인했고 그대로 추가해요</label></div>}{error && <p role="alert" className="ce-error">{error}</p>}<div className="ce-toolbar"><button disabled={busy} onClick={() => setKind(null)}>닫기</button><button className="ce-primary" disabled={busy} onClick={save}>회차 추가</button></div></div>}</section>;
}
