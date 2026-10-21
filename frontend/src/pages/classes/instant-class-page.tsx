import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Clock3, History, MapPin, SlidersHorizontal, UserPlus, Users, Video, X, Zap } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import { getClass } from '../../lib/api/class-structure';
import { schedulingApi, type InstructorCandidate, type SchedulePreview, type WriteResult } from '../../lib/api/class-scheduling';
import { defaultInstantSettings, instantSchedule, instantTitle, loadInstantSettings, saveInstantSettings, type InstantSettings } from '../../lib/class-structure/instant-class-model';
import { operationKeys, scheduleProblems, schedulingError } from '../../lib/class-structure/scheduling-model';
import { asClassId } from '../../lib/class-structure/read-model';
import { WizardSheet, WizardToggle } from './wizard-visual-components';
import { InstantClassShare } from './instant-class-share';
import { InstantInviteSheet, type InstantInviteSelection } from './instant-invite-sheet';
import './class-scheduling.css';
import './instant-class.css';
export function InstantClassPage() {
  const user = useAuthStore(state => state.user); const [search] = useSearchParams();
  return user ? <InstantForm key={`${user.id}:${search.get('from') ?? ''}`} user={user} from={search.get('from')} /> : null;
}
function InstantForm({ user, from }: { user: { id: string; name?: string | null; role: string }; from: string | null }) {
  const admin = user.role === 'org_admin'; const autoTitle = useRef(instantTitle());
  const [settings, setSettings] = useState(() => loadInstantSettings(user.id)); const [title, setTitle] = useState(() => instantTitle());
  const [candidates, setCandidates] = useState<InstructorCandidate[]>([]); const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false); const [custom, setCustom] = useState(() => ![20, 30, 45, 60].includes(settings.duration_min)); const [inviteSheet, setInviteSheet] = useState(false); const [invites, setInvites] = useState<InstantInviteSelection>({ members: [], emails: [] });
  const [inviteReason, setInviteReason] = useState(''); const [inviteRefresh, setInviteRefresh] = useState(0);
  const [preview, setPreview] = useState<SchedulePreview | null>(null); const [created, setCreated] = useState<WriteResult | null>(null); const [remembered, setRemembered] = useState(false);
  const emailRetry = useRef<(() => Promise<void>) | null>(null);
  const keyFor = useRef(operationKeys()); const locked = useRef(false); const alive = useRef(true);
  useEffect(() => { alive.current = true; const controller = new AbortController();
    Promise.all([schedulingApi.candidates(undefined, controller.signal), from ? getClass(asClassId(from), controller.signal) : Promise.resolve(null)]).then(([result, detail]) => {
      if (!alive.current || controller.signal.aborted) return; setError(''); setCandidates(result.instructors);
      if (detail) { setSettings({ ...defaultInstantSettings(), duration_min: detail.default_duration_min, location_type: detail.location_type === 'offline' ? 'offline' : 'online', location_address: detail.location_address, capacity: detail.capacity, linkband_mode: detail.linkband_mode === 'none' ? 'none' : 'optional', record_audio: detail.record_audio, record_video: detail.record_video ?? false, chat_enabled: detail.chat_enabled ?? false, host_id: detail.assignment_rule?.host_ids[0] ?? detail.host_view?.instructors.find(person => person.role === 'lead')?.user_id }); setCustom(![20, 30, 45, 60].includes(detail.default_duration_min)); setRemembered(true); }
      else { try { setRemembered(Boolean(localStorage.getItem(`mb:instant-class:last:${user.id}`))); } catch { /* 저장 공간 제한 시 기본 설정을 유지한다. */ } }
      setReady(true);
    }).catch(cause => { if (alive.current && !controller.signal.aborted) setError(schedulingError(cause)); });
    return () => { alive.current = false; controller.abort(); };
  }, [from, user.id]);
  const hostId = admin ? settings.host_id ?? '' : user.id;
  const hostValid = candidates.some(candidate => candidate.id === hostId);
  const schedule = { ...instantSchedule(settings, hostId, title.trim() || autoTitle.current), member_ids: invites.members.map(member => member.userId) };
  function patch(next: Partial<InstantSettings>) { setSettings(previous => ({ ...previous, ...next })); setPreview(null); setError(''); }
  async function open(force = false) {
    if (locked.current || !ready || !hostValid) return;
    if (admin && invites.emails.length > 0 && !inviteReason.trim()) { setError('센터 관리자 대행 사유를 입력해 주세요.'); return; }
    const problems = scheduleProblems(schedule); if (problems.length) { setError(problems.join(' ')); return; }
    if (invites.members.length + invites.emails.length > settings.capacity) { setError('초대 인원이 정원을 초과했어요.'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const inspection = force && preview ? preview : await schedulingApi.preview(schedule);
      if (!alive.current) return;
      if (inspection.rows.some(row => !row.host_id)) { setError('진행 지도사를 확인해 주세요.'); return; }
      if (inspection.conflicts.some(conflict => conflict.kind !== 'place') && !force) { setPreview(inspection); return; }
      const payload = { schedule, status: 'active' as const, ...(force ? { force: true, confirmed_conflict_fingerprint: inspection.conflict_fingerprint } : {}) };
      const result = await schedulingApi.create({ ...payload, operation_key: keyFor.current(payload) });
      if (!alive.current) return; saveInstantSettings(user.id, { ...settings, host_id: hostId }); setTitle(schedule.title); setCreated(result);
      if (invites.emails.length) {
        // 생성 성공은 유지하고, 초대 실패는 공유 화면에서 재시도할 수 있게 안내한다.
        let command: Parameters<typeof schedulingApi.inviteEmails>[1] | null = null;
        emailRetry.current = async () => {
          if (!command) { const detail = await getClass(asClassId(result.class_id)); if (detail.revision === undefined) throw new Error('revision'); const payload = { emails: invites.emails, expected_revision: detail.revision, ...(admin ? { reason: inviteReason.trim() } : {}) }; command = { ...payload, operation_key: keyFor.current({ invite: result.class_id, ...payload }) }; }
          await schedulingApi.inviteEmails(result.class_id, command); emailRetry.current = null; setError(''); setInviteRefresh(value => value + 1);
        };
        try { await emailRetry.current(); }
        catch { if (alive.current) setError('클래스는 열렸지만 이메일 초대를 보내지 못했어요. 회원 초대에서 다시 시도해 주세요.'); }
      }
    } catch (cause) {
      if (!alive.current) return; setError(schedulingError(cause));
      const detail = cause instanceof ApiError ? (cause.data as { detail?: { code?: string; conflicts?: SchedulePreview['conflicts']; conflict_fingerprint?: string } } | null)?.detail : undefined;
      if (detail?.code === 'schedule_conflict' && Array.isArray(detail.conflicts) && typeof detail.conflict_fingerprint === 'string') setPreview({ rows: preview?.rows ?? [], conflicts: detail.conflicts, conflict_fingerprint: detail.conflict_fingerprint, class_revision: null });
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <main className="cs-wizard fl-root ic-root" data-screen={created ? 'IC-04' : 'IC-03'}><div className="fl-backdrop" style={{ backgroundImage: `url(/images/background${created ? 5 : 4}.webp)` }} /><div className="fl-layer"><header className="fl-top"><div className="fl-top-l"><Link className="fl-iconbtn" aria-label="클래스 목록" to="/classes"><X size={24} /></Link></div><div className="fl-top-title">{created ? title : '지금 바로 시작'}</div><div /></header>
    {created ? <><InstantClassShare key={inviteRefresh} result={created} title={schedule.title} admin={admin} capacity={settings.capacity} initialInvites={invites} />{error && <div className="ic-toast" role="alert">{error}{emailRetry.current && <button className="fl-btn soft" disabled={busy} onClick={async () => { if (locked.current) return; locked.current = true; setBusy(true); try { await emailRetry.current?.(); } catch { setError('이메일 초대를 보내지 못했어요. 다시 시도해 주세요.'); } finally { locked.current = false; setBusy(false); } }}>이메일 초대 다시 보내기</button>}</div>}</> : <div className="fl-body ic-form-body"><div className="ic-split"><section className="fl-card strong ic-form"><fieldset className="ic-fieldset" disabled={busy}><h1 className="fl-h1">지금 바로 열어요</h1>{remembered && <p className="ic-remember"><History size={18} />지난 즉석 클래스 설정을 불러왔어요</p>}
      {admin && <label className="fl-field"><span className="fl-label">진행 지도사 · 필수</span><select className="fl-input" aria-label="진행 지도사" disabled={busy} value={hostId} onChange={event => patch({ host_id: event.target.value })}><option value="">지금 진행할 지도사를 골라 주세요</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name ?? '이름 미확인'}</option>)}</select></label>}
      <label className="fl-field"><span className="fl-label">클래스 이름</span><input className="fl-input" aria-label="클래스 이름" maxLength={200} disabled={busy} value={title} onChange={event => { setTitle(event.target.value); setPreview(null); }} /><span className="w-hint">비워 두면 자동 이름으로 만들어요</span></label>
      <div className="fl-field"><span className="fl-label">소요 시간</span><div className="ic-chips">{[20, 30, 45, 60].map(duration => <button key={duration} disabled={busy} className={!custom && settings.duration_min === duration ? 'on' : ''} onClick={() => { setCustom(false); patch({ duration_min: duration }); }}>{duration}분</button>)}<button disabled={busy} className={custom ? 'on' : ''} onClick={() => setCustom(true)} aria-label="직접 입력"><span className="ic-direct-full">직접 입력</span><span className="ic-direct-short">직접</span></button></div>{custom && <input className="fl-input" aria-label="소요 시간 직접 입력" type="number" min={5} max={480} step={5} value={settings.duration_min} onChange={event => patch({ duration_min: Number(event.target.value) })} />}</div>
      <div className="fl-field"><span className="fl-label">진행 방식</span><div className="fl-seg"><button disabled={busy} className={settings.location_type === 'online' ? 'on' : ''} onClick={() => patch({ location_type: 'online' })}><Video size={20} />온라인</button><button disabled={busy} className={settings.location_type === 'offline' ? 'on' : ''} onClick={() => patch({ location_type: 'offline', record_video: false })}><MapPin size={20} />오프라인(대면)</button></div></div>
      {settings.location_type === 'offline' && <label className="fl-field"><span className="fl-label">장소 주소 · 필수</span><input className="fl-input" aria-label="장소 주소" value={settings.location_address ?? ''} onChange={event => patch({ location_address: event.target.value })} /></label>}
      <button className="ic-more" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><SlidersHorizontal size={20} /><span>더보기 · 정원 {settings.capacity}명 · LINK BAND {settings.linkband_mode === 'optional' ? '선택' : '없음'} · 녹음 {settings.record_audio ? '켬' : '끔'} · 채팅 {settings.chat_enabled ? '켬' : '끔'}</span></button>
      {advanced && <div className="ic-advanced"><label className="fl-field"><span className="fl-label">정원</span><input className="fl-input" aria-label="정원" type="number" min={2} max={settings.location_type === 'online' ? 50 : 100} value={settings.capacity} onChange={event => patch({ capacity: Number(event.target.value) })} /></label><WizardToggle title="LINK BAND 선택" checked={settings.linkband_mode === 'optional'} onChange={() => patch({ linkband_mode: settings.linkband_mode === 'optional' ? 'none' : 'optional' })}><Users size={20} /></WizardToggle>{(['record_audio', ...(settings.location_type === 'online' ? ['record_video'] as const : []), 'chat_enabled'] as const).map(key => <WizardToggle key={key} title={{ record_audio: '음성 녹음', record_video: '영상 녹화', chat_enabled: '채팅' }[key]} checked={settings[key]} onChange={() => patch({ [key]: !settings[key] })}><Video size={20} /></WizardToggle>)}</div>}
      <button className="ic-invite" onClick={() => setInviteSheet(true)}><UserPlus size={20} /><span><b>회원 초대 (선택){invites.members.length + invites.emails.length > 0 && ` · ${invites.members.length + invites.emails.length}명`}</b><small>지금 골라도, 열린 뒤에 코드로 들여보내도 돼요</small></span></button>{admin && invites.emails.length > 0 && <label className="fl-field"><span className="fl-label">센터 관리자 대행 사유</span><input className="fl-input" aria-label="센터 관리자 대행 사유" value={inviteReason} maxLength={1000} onChange={event => setInviteReason(event.target.value)} /></label>}{error && <p role="alert">{error}</p>}
    </fieldset></section><aside className="fl-card ic-summary"><h3>열면 이렇게 돼요</h3><p><Clock3 size={20} />지금 · {settings.duration_min}분 · 1회</p><p><Users size={20} />{hostValid ? `${candidates.find(candidate => candidate.id === hostId)?.name ?? user.name ?? '지도사'} 진행 · 정원 ${settings.capacity}명` : '진행 지도사 미선택'}</p><ol><li>대기실이 바로 열려요. 수업 시작은 진행 화면에서 직접 눌러요.</li><li>클래스 코드·QR·링크로 회원을 들여보내요.</li><li>수업 중에도 회원을 초대할 수 있어요.</li></ol><div className="ic-submit"><button className="fl-btn primary block" disabled={busy || !ready || !hostValid || (settings.location_type === 'offline' && !settings.location_address?.trim())} onClick={() => void open()}><Zap size={22} />{busy ? '여는 중…' : '지금 열기'}</button><span className="w-hint">{!hostValid && admin ? '진행 지도사를 고르면 열 수 있어요' : '나중에 이름·설정을 바꿀 수 있어요'}</span></div></aside></div></div>}
    {!created && inviteSheet && <InstantInviteSheet capacity={settings.capacity} admin={admin} selected={invites} onClose={() => setInviteSheet(false)} onSent={selection => { setInvites(selection); setPreview(null); setInviteSheet(false); }} />}
    {!created && preview && <WizardSheet title="겹치는 일정을 확인해 주세요" onClose={() => setPreview(null)} footer={<button className="fl-btn primary block" disabled={busy} onClick={() => void open(true)}>그대로 열기</button>}><p>이미 잡힌 일정이 있어요. 확인하고 그대로 열 수 있어요.</p><ul>{preview.conflicts.map((conflict, index) => <li key={index}>{conflict.visible ? conflict.parent_title ?? '일정' : '다른 일정'} · {new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(new Date(conflict.starts_at))}</li>)}</ul></WizardSheet>}
  </div></main>;
}
