import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useWizardLeaveGuard } from '../../hooks/useWizardLeaveGuard';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import { getClass, getClasses, type ClassSummaryDto } from '../../lib/api/class-structure';
import { asClassId } from '../../lib/class-structure/read-model';
import { schedulingApi, type ScheduleInput, type SchedulePreview, type InstructorCandidate, type WriteResult } from '../../lib/api/class-scheduling';
import { defaultSchedule, koreanToday, operationKeys, parseInviteEmails, parseInviteCsv, scheduleProblems, schedulingError } from '../../lib/class-structure/scheduling-model';
import { ArrowDown, ArrowUp, Bookmark, CalendarDays, CalendarX, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, Info, ListChecks, Mail, MapPin, MessageCircle, Mic, Pencil, Plus, Repeat2, Search, SlidersHorizontal, Upload, UserPlus, Users, Video, X, AlertTriangle } from 'lucide-react';
import { WizardDateTime, WizardField as Field, WizardSheet, WizardStepper, WizardToggle } from './wizard-visual-components';
import { ClassMemberPicker, type ClassMemberSelection } from '../../components/class/structure/class-member-picker';
import './class-scheduling.css';

const steps = ['기본 정보', '일정 형태', '강사 배정', '초대·확인'];
const days = ['월', '화', '수', '목', '금', '토', '일'];
export function ClassSchedulingWizard() {
  const user = useAuthStore(state => state.user);
  const [search] = useSearchParams();
  return user ? <Wizard key={`${user.id}:${search.toString()}`} user={user} draftId={search.get('draft')} copyId={search.get('copy')} /> : null;
}
function Wizard({ user, draftId, copyId }: { user: { id: string; role: string }; draftId: string | null; copyId: string | null }) {
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState(() => defaultSchedule(user.role === 'counselor' ? user.id : null));
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(Boolean(draftId || copyId));
  const [sheet, setSheet] = useState<'clone' | 'instructors' | 'schedule' | 'conflicts' | null>(null);
  const [pastClasses, setPastClasses] = useState<ClassSummaryDto[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState('');
  const [selectedCopy, setSelectedCopy] = useState('');
  const [instructorSearch, setInstructorSearch] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [inviteTab, setInviteTab] = useState<'members' | 'emails'>('members');
  const [selectedMembers, setSelectedMembers] = useState<ClassMemberSelection[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [savedKind, setSavedKind] = useState<'draft' | 'active'>('active');
  const [copied, setCopied] = useState(false);
  const csvInput = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<InstructorCandidate[]>([]);
  const [available, setAvailable] = useState(false);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emails, setEmails] = useState('');
  const [leave, setLeave] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');
  const [created, setCreated] = useState<WriteResult | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [inviteState, setInviteState] = useState<'none' | 'pending' | 'failed'>('none');
  const alive = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const previewRequest = useRef<AbortController | null>(null);
  const keyFor = useRef(operationKeys());
  const saved = useRef<{ id: string; revision: number; input: string } | null>(null);
  const sourceRevision = useRef<number | undefined>(undefined);
  const [copyMembers, setCopyMembers] = useState(false);
  const [copyDate, setCopyDate] = useState(koreanToday());
  const [copyReady, setCopyReady] = useState(!copyId);
  const { blocker, bypass } = useWizardLeaveGuard(dirty && !created);

  useEffect(() => {
    alive.current = true;
    let active = true;
    const controller = new AbortController();
    Promise.all([schedulingApi.candidates(draftId || copyId || undefined, controller.signal), draftId || copyId ? getClass(asClassId((draftId || copyId)!), controller.signal) : Promise.resolve(null)])
      .then(([result, detail]) => {
        if (!active) return;
        setCandidates(result.instructors);
        if (detail && detail.capabilities?.schedule !== true) { setError('이 클래스의 편성을 수정할 권한이 없어요.'); return; }
        if (detail) sourceRevision.current = detail.revision;
        if (draftId) {
          if (!detail?.draft_schedule || detail.status !== 'draft') { setError('이어 쓸 수 있는 초안이 없어요.'); return; }
          setSchedule(detail.draft_schedule);
          setSelectedMembers(detail.draft_schedule.member_ids.map(userId => ({ userId, name: '선택한 회원' })));
        }
        setAvailable(true);
      }).catch((error: unknown) => { if (active) setError(schedulingError(error)); });
    return () => { active = false; alive.current = false; generation.current += 1; controller.abort(); previewRequest.current?.abort(); };
  }, [draftId, copyId]);
  function change(next: ScheduleInput) {
    generation.current += 1; previewRequest.current?.abort(); setSchedule(next); setDirty(true); setPreview(null); setConfirmed(false); setError('');
  }
  function patch(next: Partial<ScheduleInput>) { change({ ...schedule, ...next }); }
  function rule(next: Partial<ScheduleInput['recurrence_rule']>) { patch({ recurrence_rule: { ...schedule.recurrence_rule, ...next }, rows: [] }); }
  async function execute(action: () => Promise<void>) {
    if (locked.current || !available) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) { if (alive.current) { setError(schedulingError(error)); setConfirmed(false);
        if (error instanceof ApiError) {
          const detail = (error.data as { detail?: { code?: string; conflicts?: SchedulePreview['conflicts']; conflict_fingerprint?: string } } | null)?.detail;
          if (detail?.code === 'schedule_conflict' && Array.isArray(detail.conflicts) && typeof detail.conflict_fingerprint === 'string') {
            setPreview(previous => previous ? { ...previous, conflicts: detail.conflicts!, conflict_fingerprint: detail.conflict_fingerprint! } : null);
          }
        } } }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function inspect(advance: boolean) {
    const issues = scheduleProblems(schedule);
    if (issues.length) { setError(issues.join(' ')); return; }
    const current = generation.current;
    await execute(async () => {
      previewRequest.current?.abort();
      const controller = new AbortController(); previewRequest.current = controller;
      const result = await schedulingApi.preview(schedule, controller.signal);
      if (!alive.current || generation.current !== current) return;
      setPreview(result); setConfirmed(false);
      if (advance) {
        if (result.rows.some(row => !row.host_id)) { setError('진행 지도사가 미정인 회차가 있어요. 배정하거나 초안으로 저장해 주세요.'); return; }
        setStep(3);
      }
    });
  }
  async function next() {
    const issues = scheduleProblems(schedule, koreanToday(), step);
    if (issues.length) { setError(issues.join(' ')); return; }
    if (step === 2) { await inspect(true); return; }
    setError(''); setStep(step + 1);
    if (step === 1) await inspect(false);
  }
  async function sendInvitations(result: WriteResult) {
    const addresses = parseInviteEmails(emails);
    if (!addresses.length) return;
    const payload = { expected_revision: result.revision, emails: addresses, ...(reason.trim() ? { reason: reason.trim() } : {}) };
    try {
      await schedulingApi.inviteEmails(result.class_id, { ...payload, operation_key: keyFor.current({ invite: result.class_id, ...payload }) });
      if (alive.current) setInviteState('pending');
    } catch { if (alive.current) setInviteState('failed'); }
  }
  async function save(status: 'draft' | 'active') {
    if (user.role === 'org_admin' && (draftId || parseInviteEmails(emails).length > 0) && !reason.trim()) { setError('센터 관리자 대행 사유를 입력해 주세요.'); return; }
    const issues = scheduleProblems(schedule);
    if (issues.length) { setError(issues.join(' ')); return; }
    if (status === 'active' && (!preview || preview.rows.some(row => !row.host_id))) { setError('일정을 확인하고 모든 회차의 진행 지도사를 배정해 주세요.'); return; }
    const needsConfirmation = preview?.conflicts.some(item => item.kind !== 'place') ?? false;
    if (status === 'active' && needsConfirmation && !confirmed) { setError('겹치는 일정을 확인해 주세요.'); return; }
    if (parseInviteEmails(emails).length > 100) { setError('초대 이메일은 한 번에 100개까지 입력해 주세요.'); return; }
    if (parseInviteEmails(emails).some(email => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) { setError('초대 이메일 주소를 확인해 주세요.'); return; }
    await execute(async () => {
      const confirmation = status === 'active' && confirmed ? { force: true, confirmed_conflict_fingerprint: preview!.conflict_fingerprint } : {};
      let result: WriteResult;
      if (draftId) {
        const input = JSON.stringify(schedule);
        if (!saved.current || saved.current.input !== input) {
          const payload = { schedule, expected_revision: saved.current?.revision ?? sourceRevision.current, ...(reason.trim() ? { reason: reason.trim() } : {}) };
          const updated = await schedulingApi.update(draftId, { ...payload, operation_key: keyFor.current({ update: draftId, ...payload }) });
          saved.current = { id: draftId, revision: updated.revision, input };
        }
        if (!alive.current) return;
        result = { class_id: draftId, revision: saved.current.revision };
        if (status === 'active') {
          const payload = { expected_revision: result.revision, ...confirmation, ...(reason.trim() ? { reason: reason.trim() } : {}) };
          result = await schedulingApi.publish(draftId, { ...payload, operation_key: keyFor.current({ publish: draftId, ...payload }) });
        }
      } else {
        const payload = { schedule, status, ...confirmation };
        result = await schedulingApi.create({ ...payload, operation_key: keyFor.current(payload) });
      }
      if (!alive.current) return;
      setDirty(false);
      setSavedKind(status); setCreated(result);
      if (status === 'draft') return;
      const detail = await getClass(asClassId(result.class_id)).catch(() => null);
      if (alive.current) setCode(detail?.host_view?.access_code ?? null);
      if (alive.current) await sendInvitations(result);
    });
  }
  async function duplicate() {
    if (user.role === 'org_admin' && !reason.trim()) { setError('센터 관리자 대행 사유를 입력해 주세요.'); return; }
    if (!copyId || copyDate < koreanToday()) { setError('시작 날짜는 오늘 이후로 정해 주세요.'); return; }
    await execute(async () => {
      const payload = { start_date: copyDate, invite_members: copyMembers, expected_revision: sourceRevision.current, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      const result = await schedulingApi.duplicate(copyId, { ...payload, operation_key: keyFor.current({ copyId, ...payload }) });
      if (alive.current) { bypass(); navigate(`/classes/new?draft=${encodeURIComponent(result.class_id)}`, { replace: true }); }
    });
  }
  useEffect(() => {
    if (sheet !== 'clone') return;
    const controller = new AbortController(); let active = true;
    setPastLoading(true); setPastError('');
    getClasses({ status: 'completed', limit: 20 }, controller.signal).then(result => { if (active) setPastClasses(result.classes); })
      .catch(() => { if (active) setPastError('지난 클래스 목록을 가져오지 못했어요. 잠시 뒤 다시 열어 주세요.'); })
      .finally(() => { if (active) setPastLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [sheet]);

  const hostName = (id: string | null) => candidates.find(person => person.id === id)?.name ?? '미정';
  const hostOptions = <><option value="">미정</option>{schedule.instructors.map(person => <option key={person.user_id} value={person.user_id}>{hostName(person.user_id)}</option>)}</>;
  const dateLabel = (date: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(date));
  const timeLabel = (date: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
  const rows = preview?.rows ?? schedule.rows;
  const disabled = busy || !available;
  const addresses = parseInviteEmails(emails);
  const copySetup = Boolean(copyId && !copyReady);
  const isForm = started && !created && !copySetup;
  function leaveWizard() { if (dirty && !created) setLeave(true); else navigate('/classes'); }
  function instructorToggle(id: string) {
    const exists = schedule.instructors.some(person => person.user_id === id);
    patch({ instructors: exists ? schedule.instructors.filter(person => person.user_id !== id) : [...schedule.instructors, { user_id: id, role: schedule.instructors.length ? 'assistant' : 'lead' }],
      assignment_rule: { ...schedule.assignment_rule,
        host_ids: exists ? schedule.assignment_rule.host_ids.filter(host => host !== id) : schedule.assignment_rule.mode === 'rotate' ? [...schedule.assignment_rule.host_ids, id] : schedule.assignment_rule.mode === 'all_one' ? [schedule.assignment_rule.host_ids[0] ?? id] : schedule.assignment_rule.host_ids,
        weekday_hosts: Object.fromEntries(Object.entries(schedule.assignment_rule.weekday_hosts).map(([day, host]) => [day, exists && host === id ? null : host])) }, rows: [] });
  }
  function assignment(mode: ScheduleInput['assignment_rule']['mode']) {
    patch({ assignment_rule: { ...schedule.assignment_rule, mode,
      host_ids: mode === 'per_session' || mode === 'by_weekday' ? [] : mode === 'all_one' ? [schedule.instructors[0]?.user_id ?? null] : schedule.instructors.map(person => person.user_id),
      weekday_hosts: Object.fromEntries(schedule.recurrence_rule.weekdays.map(day => [day, schedule.assignment_rule.weekday_hosts[day] ?? null])) }, rows: [] });
  }
  function reorder(index: number, direction: number) {
    const ids = [...schedule.assignment_rule.host_ids]; [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    patch({ assignment_rule: { ...schedule.assignment_rule, host_ids: ids }, rows: [] });
  }
  function addEmail() {
    const added = parseInviteEmails(emailInput);
    if (!added.length || added.some(email => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) { setError('이메일 형식을 확인해 주세요.'); return; }
    const all = [...new Set([...addresses, ...added])];
    if (all.length > 100) { setError('초대 이메일은 한 번에 100개까지 입력해 주세요.'); return; }
    setEmails(all.join('\n')); setEmailInput(''); setDirty(true); setError('');
  }
  async function importCsv(file?: File) {
    if (!file) return;
    if (file.size > 1024 * 1024) { setError('CSV 파일은 1MB 이하로 올려 주세요.'); return; }
    try { const imported = parseInviteCsv(await file.text()); if (alive.current) { setEmails(imported.join('\n')); setInviteTab('emails'); setDirty(true); setError(''); } }
    catch (error) { if (alive.current) setError(error instanceof Error && error.message.startsWith('CSV') ? error.message : 'CSV 파일을 읽지 못했어요. UTF-8 이메일 파일을 확인해 주세요.'); }
  }
  const reasonField = user.role === 'org_admin' && <Field title="센터 관리자 대행 사유"><textarea className="fl-input cw-reason" aria-label="센터 관리자 대행 사유" maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); setDirty(true); }} placeholder="초안 수정·공개·초대 사유를 입력해 주세요" /></Field>;
  const conflictNotice = preview && preview.conflicts.length > 0 && <button className="w-note warn cw-text-button" onClick={() => setSheet('conflicts')}><AlertTriangle size={20} /><span>겹치는 일정 {preview.conflicts.length}건을 확인해 주세요</span><ChevronRight size={20} /></button>;

  return <main className="cs-wizard fl-root w-wiz" data-screen={!started ? 'CH10' : created ? 'CH15' : `CH${11 + step}`}>
    <div className="fl-backdrop" style={{ backgroundImage: `url(/images/background${!started || created ? 5 : 4}.webp)` }} />
    <div className="fl-layer">
      <header className="fl-top"><div className="fl-top-l"><button className="fl-iconbtn" aria-label="만들기 나가기" onClick={leaveWizard}><X size={24} /></button></div><div className="fl-top-title">클래스 만들기</div><div className="fl-top-r">{isForm && <button className="cw-save" data-save-draft disabled={disabled} onClick={() => save('draft')}><Bookmark size={16} /><span>초안 저장</span></button>}</div></header>
      {isForm && <ol className="fl-steps" aria-label="편성 단계">{steps.map((label, index) => <li className={step === index ? 'on' : step > index ? 'done' : ''} key={label} aria-current={step === index ? 'step' : undefined}><span className="cw-sr-only">{index + 1}. {label}</span></li>)}</ol>}
      <div className={`fl-body${isForm && step >= 2 ? ' w-fill' : ''}`}><div className="fl-col">
        {!started ? <><h1 className="fl-h1">어떻게 시작할까요?</h1><p className="fl-sub">처음부터 만들거나, 지난 클래스를 그대로 가져와 새 기수로 시작해요.</p><div className="w-startcards"><button className="w-startcard" onClick={() => setStarted(true)}><span className="ico"><Plus /></span><span className="tx"><b>처음부터 만들어요</b><span>이름·일정·강사를 새로 정해요</span></span></button><button className="w-startcard" onClick={() => setSheet('clone')}><span className="ico"><Copy /></span><span className="tx"><b>지난 클래스 그대로 시작해요</b><span>요일·시각·횟수·강사 배정을 가져와요</span></span></button></div></> : created ? <>
          <div className="w-ok">{savedKind === 'draft' ? <Bookmark /> : <Check />}</div><h1 className="fl-h1">{savedKind === 'draft' ? '편성을 저장했어요' : '클래스를 만들었어요'}</h1><div className="fl-chiprow"><span className="fl-chip">{schedule.title}</span><span className="fl-chip">{schedule.schedule_mode === 'rolling' ? '정기형' : `${schedule.planned_session_count}회`}</span><span className="fl-chip">{schedule.location_type === 'online' ? '온라인' : '오프라인'}</span></div>
          {savedKind === 'draft' ? <section className="fl-card strong w-card"><h2 className="fl-h2">나중에 이어서 편성할 수 있어요</h2><p className="fl-sub">모든 회차의 진행 강사를 정하면 클래스를 공개하고 멤버를 초대할 수 있어요.</p></section> : <><section className="fl-card strong w-card w-codecard"><span className="fl-label">클래스 코드</span><div className="w-coderow"><strong className="w-codebig">{code ?? '상세에서 확인'}</strong><button className="fl-btn soft" disabled={!code} onClick={async () => { try { await navigator.clipboard.writeText(code!); setCopied(true); } catch { setError('코드를 복사하지 못했어요. 표시된 코드를 직접 전달해 주세요.'); } }}><Copy size={20} />{copied ? '복사했어요' : '코드 복사'}</button></div><div className="w-note"><Info size={20} /><span>코드는 멤버에게만 전달하세요</span></div></section><section className="fl-card strong w-card"><h2 className="fl-h2">{selectedMembers.length ? `회원 ${selectedMembers.length}명을 선택했어요` : addresses.length ? `이메일 ${addresses.length}명` : '초대한 멤버가 아직 없어요'}</h2><p className="fl-sub" role="status">{inviteState === 'pending' ? '이메일 전달을 요청했어요. 발송 상태는 멤버 탭에서 확인할 수 있어요.' : inviteState === 'failed' ? '클래스는 저장됐지만 이메일 초대 요청을 완료하지 못했어요.' : '클래스 상세에서 멤버와 초대 상태를 확인할 수 있어요.'}</p>{inviteState === 'failed' && <button className="fl-btn soft" disabled={busy} onClick={() => execute(() => sendInvitations(created))}>초대 요청 다시 시도</button>}</section></>}
        </> : copySetup ? <section className="fl-card strong w-card"><h1 className="fl-h1">지난 기수 그대로 시작해요</h1><p className="fl-sub">요일·시각·강사 배정을 새 초안으로 가져와요. 취소·보강·개별 이동은 복사하지 않아요.</p><Field title="새 시작 날짜"><WizardDateTime label="새 시작 날짜" type="date" value={copyDate} min={koreanToday()} onChange={setCopyDate} /></Field><label className="cw-check"><input type="checkbox" checked={copyMembers} onChange={event => setCopyMembers(event.target.checked)} />기존 멤버도 새로 초대해요</label><p className="w-info">이전 고지 확인과 동의는 복사하지 않아요.</p>{reasonField}</section> : <>
          {step === 3 && <section className="fl-card strong w-card w-sum"><div className="fl-row w-sumrow"><CalendarDays /><span className="tx">{schedule.title} · {schedule.schedule_mode === 'fixed' ? `${schedule.planned_session_count}회` : '정기형'} · {dateLabel(`${schedule.recurrence_rule.start_date}T12:00:00+09:00`)} 시작 · {schedule.recurrence_rule.interval_weeks === 1 ? '매주' : `${schedule.recurrence_rule.interval_weeks}주마다`} {schedule.recurrence_rule.weekdays.map(day => days[day - 1]).join('·')} {schedule.recurrence_rule.time}</span><button className="w-edit" aria-label="일정 수정" onClick={() => setStep(1)}><Pencil size={20} /></button></div><div className="fl-row w-sumrow"><Users /><span className="tx">{schedule.instructors.map(person => hostName(person.user_id)).join('·')} · {schedule.location_type === 'online' ? '온라인' : '오프라인'} · 정원 {schedule.capacity}명</span><button className="w-edit" aria-label="강사 수정" onClick={() => setStep(2)}><Pencil size={20} /></button></div>{preview ? preview.conflicts.length ? conflictNotice : <div className="w-note ok"><CheckCircle2 size={20} /><span>겹치는 일정이 없어요.</span></div> : <button className="fl-btn soft" disabled={disabled} onClick={() => inspect(false)}>초대할 멤버의 일정 확인</button>}</section>}
          <section className={`fl-card strong w-card${step === 3 ? ' w-invs' : ''}`}>
          {step < 3 && <h1 className="fl-h1">{['기본 정보를 정해요', '언제 진행할까요?', '누가 진행할까요?'][step]}</h1>}
          <fieldset disabled={disabled} className={`w-form cw-form${step >= 2 ? ' cw-grow' : ''}`}>
          {step === 0 && <><Field title="클래스 이름"><div className="w-inwrap"><Pencil className="ic" size={20} /><input className="fl-input" aria-label="클래스 이름" name="title" value={schedule.title} maxLength={200} onChange={event => patch({ title: event.target.value })} placeholder="클래스 이름 (예: MBSR 봄, 점심 명상)" /></div></Field><div className="w-2col"><Field title="진행 방식"><div className="fl-seg w-flex">{(['online', 'offline'] as const).map(mode => <button type="button" key={mode} className={schedule.location_type === mode ? 'on' : ''} aria-pressed={schedule.location_type === mode} onClick={() => patch({ location_type: mode, record_video: mode === 'offline' ? false : schedule.record_video, rows: [] })}>{mode === 'online' ? <Video size={20} /> : <MapPin size={20} />}{mode === 'online' ? '온라인' : '오프라인(대면)'}</button>)}</div></Field><Field title="정원"><WizardStepper label="정원" name="capacity" prefix="정원" value={schedule.capacity} min={2} max={schedule.location_type === 'online' ? 50 : 100} unit="명" onChange={capacity => patch({ capacity })} /></Field></div>{schedule.location_type === 'offline' && <><div className="w-inwrap"><MapPin className="ic" size={20} /><input className="fl-input" aria-label="장소 주소" value={schedule.location_address ?? ''} maxLength={300} placeholder="장소 주소를 입력해 주세요" onChange={event => patch({ location_address: event.target.value, rows: [] })} /></div><p className="w-info"><Info size={20} />대면 클래스는 영상 녹화 없이 진행해요.</p></>}
          <button className="fl-row w-sumrow" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><SlidersHorizontal /><span className="tx">고급 설정 · LINK BAND·녹음</span><ChevronDown size={20} /></button>{advanced && <><Field title="LINK BAND 사용"><div className="fl-seg">{(['none', 'optional'] as const).map(mode => <button key={mode} className={schedule.linkband_mode === mode ? 'on' : ''} aria-pressed={schedule.linkband_mode === mode} onClick={() => patch({ linkband_mode: mode })}>{mode === 'none' ? '사용 안 함' : '선택'}</button>)}</div></Field><div className="w-2col"><WizardToggle title="음성 녹음" checked={schedule.record_audio} onChange={() => patch({ record_audio: !schedule.record_audio })}><Mic /></WizardToggle>{schedule.location_type === 'online' && <WizardToggle title="영상 녹화" checked={schedule.record_video} onChange={() => patch({ record_video: !schedule.record_video })}><Video /></WizardToggle>}<WizardToggle title="채팅" checked={schedule.chat_enabled} onChange={() => patch({ chat_enabled: !schedule.chat_enabled })}><MessageCircle /></WizardToggle></div></>}</>}
          {step === 1 && <><div className="fl-seg w-flex">{(['fixed', 'rolling'] as const).map(mode => <button key={mode} className={schedule.schedule_mode === mode ? 'on' : ''} aria-pressed={schedule.schedule_mode === mode} onClick={() => patch({ schedule_mode: mode, rows: [] })}>{mode === 'fixed' ? <ListChecks size={20} /> : <Repeat2 size={20} />}{mode === 'fixed' ? '정해진 횟수' : '계속 이어져요'}</button>)}</div><div className="w-sched"><Field title="시작 날짜"><WizardDateTime label="시작 날짜" type="date" min={koreanToday()} value={schedule.recurrence_rule.start_date} onChange={start_date => rule({ start_date })} /></Field><Field title="시작 시각 · 5분"><WizardDateTime label="시작 시각" type="time" min="07:00" max="22:00" value={schedule.recurrence_rule.time} onChange={time => rule({ time })} /></Field><Field title="소요 시간"><WizardStepper label="소요 시간" value={schedule.duration_min} min={5} max={480} step={5} unit="분" onChange={duration_min => patch({ duration_min, rows: [] })} /></Field><Field title="횟수">{schedule.schedule_mode === 'fixed' ? <WizardStepper label="횟수" value={schedule.planned_session_count} min={2} max={52} unit="회" onChange={planned_session_count => patch({ planned_session_count, rows: [] })} /> : <div className="fl-row w-info">끝 없이 이어져요</div>}</Field><Field title="예약 알림" className="span2"><div className="fl-seg w-c4">{[['', '끄기'], ['1440', '하루 전'], ['60', '1시간 전'], ['1440,60', '둘 다']].map(([value, label]) => <button key={value} className={schedule.reminder_offsets.join(',') === value ? 'on' : ''} aria-pressed={schedule.reminder_offsets.join(',') === value} onClick={() => patch({ reminder_offsets: value ? value.split(',').map(Number) : [] })}>{label}</button>)}</div></Field></div><Field title="요일"><div className="w-days" role="group" aria-label="요일">{days.map((day, index) => <button key={day} className={schedule.recurrence_rule.weekdays.includes(index + 1) ? 'on' : ''} aria-pressed={schedule.recurrence_rule.weekdays.includes(index + 1)} onClick={() => rule({ weekdays: schedule.recurrence_rule.weekdays.includes(index + 1) ? schedule.recurrence_rule.weekdays.filter(n => n !== index + 1) : [...schedule.recurrence_rule.weekdays, index + 1].sort() })}><span>{day}</span></button>)}</div></Field><button className="w-note cw-text-button" onClick={() => setSheet('schedule')}><CalendarX size={20} /><span>{schedule.recurrence_rule.skip_dates.length ? `건너뛸 날짜 ${schedule.recurrence_rule.skip_dates.length}개` : '건너뛸 날짜·반복 간격 설정'} · 공휴일은 자동으로 건너뛰지 않아요</span><Pencil size={20} /></button>{schedule.schedule_mode === 'rolling' && <p className="w-info"><Info size={20} />처음 4주 분량을 만들고 이후 일정은 자동으로 이어져요.</p>}</>}
          {step === 2 && <><Field title="강사 구성"><div className="w-pchips">{schedule.instructors.map(person => <button key={person.user_id} className="w-pchip" onClick={() => setSheet('instructors')}>{hostName(person.user_id)} · {person.role === 'lead' ? '주강사' : '강사'}</button>)}<button className="fl-btn soft" onClick={() => setSheet('instructors')}><UserPlus size={20} />강사 추가</button></div></Field><Field title="배정 방식"><div className="fl-seg w-types w-asg">{([['all_one', '모두 한 분이 맡아요'], ['rotate', '번갈아 맡아요'], ['by_weekday', '요일마다 달라요'], ['per_session', '회차마다 직접 정해요']] as const).map(([mode, label]) => <button key={mode} className={schedule.assignment_rule.mode === mode ? 'on' : ''} aria-pressed={schedule.assignment_rule.mode === mode} onClick={() => assignment(mode)}>{label}</button>)}</div></Field>
          {schedule.assignment_rule.mode === 'all_one' && <div className="w-resrow"><span className="tx"><b>모든 회차</b><span>한 명이 처음부터 끝까지 맡아요</span></span><select aria-label="진행 지도사" className="cw-select" value={schedule.assignment_rule.host_ids[0] ?? ''} onChange={event => patch({ assignment_rule: { ...schedule.assignment_rule, host_ids: [event.target.value || null] }, rows: [] })}>{hostOptions}</select></div>}
          {schedule.assignment_rule.mode === 'rotate' && <div className="w-group cw-assignment-list">{schedule.assignment_rule.host_ids.map((id, index) => <div className="w-ord" key={`${id}:${index}`}><span className="no">{index + 1}</span><b>{hostName(id)}</b><button aria-label={`${index + 1}번째 강사 위로`} disabled={index === 0} onClick={() => reorder(index, -1)}><ArrowUp size={20} /></button><button aria-label={`${index + 1}번째 강사 아래로`} disabled={index === schedule.assignment_rule.host_ids.length - 1} onClick={() => reorder(index, 1)}><ArrowDown size={20} /></button></div>)}</div>}
          {schedule.assignment_rule.mode === 'by_weekday' && <div className="w-group cw-assignment-list">{schedule.recurrence_rule.weekdays.map(day => <div className="w-resrow" key={day}><b>{days[day - 1]}요일</b><select className="cw-select" aria-label={`${days[day - 1]}요일 지도사`} value={schedule.assignment_rule.weekday_hosts[day] ?? ''} onChange={event => patch({ assignment_rule: { ...schedule.assignment_rule, weekday_hosts: { ...schedule.assignment_rule.weekday_hosts, [day]: event.target.value || null } }, rows: [] })}>{hostOptions}</select></div>)}</div>}
          {schedule.assignment_rule.mode === 'per_session' && <p className="w-info"><Info size={20} />아래 목록에서 회차마다 진행 강사를 직접 골라요.</p>}
          {conflictNotice}<div className="w-group cw-grow"><div className="w-lbl"><span className="fl-label">회차 목록 {rows.length ? `· ${rows.length}개` : ''}</span><button className="cw-save" onClick={() => inspect(false)}>일정 확인</button></div><div className="w-wlist">{rows.map(row => <div className={`w-wrow${!row.host_id ? ' bad' : ''}`} key={row.client_key}><span className="tx"><b>{row.seq}회차 · {dateLabel(row.scheduled_at)}</b><span>{timeLabel(row.scheduled_at)} · {row.duration_min}분</span>{row.assignment_override && <span className="fl-chip">직접 정함</span>}{preview?.conflicts.some(conflict => conflict.candidate_key === row.client_key) && <button className="fl-chip warn" onClick={() => setSheet('conflicts')}><AlertTriangle size={16} />겹쳐요</button>}</span><select className="cw-select" aria-label={`${row.seq}회차 진행 지도사`} value={row.host_id ?? ''} onChange={event => patch({ rows: rows.map(item => item.client_key === row.client_key ? { ...item, host_id: event.target.value || null, assignment_override: true } : item) })}>{hostOptions}</select></div>)}{!rows.length && <p className="w-info">일정 확인을 누르면 편성할 회차을 볼 수 있어요.</p>}</div></div></>}
          {step === 3 && <><div className="fl-seg w-flex" role="tablist" aria-label="초대 방법"><button role="tab" aria-selected={inviteTab === 'members'} className={inviteTab === 'members' ? 'on' : ''} onClick={() => setInviteTab('members')}><Users size={20} />회원</button><button role="tab" aria-selected={inviteTab === 'emails'} className={inviteTab === 'emails' ? 'on' : ''} onClick={() => setInviteTab('emails')}><Mail size={20} />비회원 이메일</button></div><input className="cw-sr-only" ref={csvInput} type="file" accept=".csv,text/csv" aria-label="CSV로 이메일 가져오기" onChange={event => void importCsv(event.target.files?.[0])} />
          {inviteTab === 'members' ? <div className="cw-invite-members cw-grow"><ClassMemberPicker className="cw-member-picker" selected={selectedMembers} maxParticipants={schedule.capacity} disabled={disabled} onChange={items => { setSelectedMembers(items); patch({ member_ids: items.map(item => item.userId) }); }} /><div className="w-count"><span><b>{selectedMembers.length ? `${selectedMembers.length}/${schedule.capacity}명` : '선택 없음'}</b>{!selectedMembers.length && ' · 나중에 초대해도 돼요'}</span><button className="fl-btn soft" onClick={() => csvInput.current?.click()}><Upload size={20} />CSV 추가</button></div></div> : <><div className="w-emailin"><div className="w-inwrap"><Mail className="ic" size={20} /><input className="fl-input" aria-label="초대할 이메일" value={emailInput} onChange={event => setEmailInput(event.target.value)} placeholder="name@example.com" inputMode="email" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addEmail(); } }} /></div><button className="fl-btn soft" onClick={addEmail}><Plus size={20} />추가</button></div><div className="w-count"><span><b>이메일 {addresses.length}명</b> · 메일에 클래스 코드가 들어가요</span><button className="fl-btn soft" onClick={() => csvInput.current?.click()}><Upload size={20} />CSV 추가</button></div><div className="w-plist">{addresses.map(email => <div className="w-erow" key={email}><span className="av"><Mail size={20} /></span><span className="em">{email}</span><button className="w-x" aria-label={`${email} 삭제`} onClick={() => { setEmails(addresses.filter(item => item !== email).join('\n')); setDirty(true); }}><X size={20} /></button></div>)}</div><p className="w-info">초대는 건너뛰어도 돼요. 만든 뒤 코드로 합류할 수 있어요.</p></>}
          {preview?.conflicts.some(item => item.kind !== 'place') && <label className="cw-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />겹치는 일정을 확인했고 그대로 편성해요</label>}</>}
          {(step === 3 || (draftId && step === 0)) && reasonField}
          </fieldset></section>
        </>}
      </div></div>
      <footer className="fl-foot"><div className="fl-col">
        {!started ? <Link className="fl-btn ghost" to="/classes">목록으로 돌아가기</Link> : created ? <><Link className="fl-btn primary block" to={savedKind === 'draft' ? `/classes/new?draft=${encodeURIComponent(created.class_id)}` : created.session_ids?.[0] ? `/classes/${created.class_id}/sessions/${created.session_ids[0]}` : `/classes/${created.class_id}`} onClick={bypass}>{savedKind === 'draft' ? <Pencil size={20} /> : <CalendarDays size={20} />}{savedKind === 'draft' ? '편성 이어서 하기' : created.session_ids?.[0] ? '첫 회차 보러 가기' : '클래스 보기'}</Link><Link className="fl-btn ghost" to="/classes"><ListChecks size={16} />클래스 목록</Link></> : copySetup ? <div className="w-nav2"><button className="fl-btn soft" onClick={() => setCopyReady(true)}>직접 입력하기</button><button className="fl-btn primary" disabled={disabled} onClick={duplicate}>초안 만들기<ChevronRight size={20} /></button></div> : step === 0 ? <button className="fl-btn primary block" disabled={disabled} onClick={next}>다음<ChevronRight size={20} /></button> : <div className="w-nav2"><button className="fl-btn soft" disabled={busy} onClick={() => { setStep(step - 1); setError(''); }}><ChevronLeft size={20} />이전</button>{step < 3 ? <button className="fl-btn primary" disabled={disabled} onClick={next}>다음<ChevronRight size={20} /></button> : <button className="fl-btn primary" disabled={disabled} onClick={() => save('active')}><Check size={20} />{busy ? '저장 중…' : '클래스 만들기'}</button>}</div>}
      </div></footer>
    </div>
    {error && <div className="fl-banner" role="alert"><AlertTriangle size={20} /><span>{error}</span><button aria-label="알림 닫기" onClick={() => setError('')}><X size={20} /></button></div>}
    {(leave || blocker.state === 'blocked') && <WizardSheet title="만들기를 그만둘까요?" onClose={() => { setLeave(false); if (blocker.state === 'blocked') blocker.reset(); }} footer={<><button className="fl-btn soft" onClick={() => { setLeave(false); if (blocker.state === 'blocked') blocker.reset(); }}>계속 만들기</button><button className="fl-btn danger" onClick={() => { bypass(); if (blocker.state === 'blocked') blocker.proceed(); else navigate('/classes'); }}>나가기</button></>}><div className="w-sico"><AlertTriangle /></div><p>저장하지 않은 입력은 사라져요.</p></WizardSheet>}
    {sheet === 'clone' && <WizardSheet title="어떤 클래스를 이어서 만들까요?" onClose={() => setSheet(null)} footer={<><button className="fl-btn soft" onClick={() => setSheet(null)}>취소</button><button className="fl-btn primary" disabled={!selectedCopy || pastLoading || Boolean(pastError)} onClick={() => navigate(`/classes/new?copy=${encodeURIComponent(selectedCopy)}`)}>이 클래스로 시작</button></>}><p>지난 클래스의 요일·시각·횟수·강사 배정을 가져와요. 멤버는 따로 선택하고 새 코드를 만들어요.</p>{pastLoading ? <p role="status">지난 클래스를 가져오고 있어요.</p> : pastError ? <p role="alert">{pastError}</p> : !pastClasses.length ? <><p>아직 지난 클래스가 없어요. 처음부터 만들어 볼까요?</p><button className="fl-btn soft" onClick={() => { setSheet(null); setStarted(true); }}>처음부터 만들기</button></> : pastClasses.map(item => <button key={item.id} className={`w-opt${selectedCopy === item.id ? ' on' : ''}`} aria-pressed={selectedCopy === item.id} onClick={() => setSelectedCopy(item.id)}><span className="av">{item.title?.slice(0, 1) ?? '명'}</span><span><span className="nm">{item.title ?? '이름 없는 클래스'}</span><span className="em">{item.schedule_mode === 'rolling' ? '정기형' : `${item.planned_session_count ?? item.session_count}회`}</span></span><span className="ck">{selectedCopy === item.id && <Check size={20} />}</span></button>)}</WizardSheet>}
    {sheet === 'instructors' && <WizardSheet title="강사 추가·역할 설정" onClose={() => setSheet(null)} footer={<><button className="fl-btn soft" onClick={() => setSheet(null)}>닫기</button><button className="fl-btn primary" onClick={() => { setSheet(null); void inspect(false); }}>일정 확인</button></>}><p>같은 센터의 지도사만 추가할 수 있어요. 주강사는 한 명으로 정해 주세요.</p><div className="w-inwrap"><Search className="ic" size={20} /><input className="fl-input" aria-label="강사 검색" placeholder="이름으로 찾아요" value={instructorSearch} onChange={event => setInstructorSearch(event.target.value)} /></div>{candidates.filter(person => (person.name ?? '').includes(instructorSearch)).map(person => { const current = schedule.instructors.find(item => item.user_id === person.id); return <div className="w-group" key={person.id}><button className={`w-opt${current ? ' on' : ''}`} aria-pressed={Boolean(current)} onClick={() => instructorToggle(person.id)}><span className="av">{person.name?.slice(0, 1) || '?'}</span><span className="nm">{person.name ?? '이름 없음'}</span><span className="ck">{current && <Check size={20} />}</span></button>{current && <select className="cw-select" aria-label={`${person.name ?? '지도사'} 역할`} value={current.role} onChange={event => patch({ instructors: schedule.instructors.map(item => item.user_id === person.id ? { ...item, role: event.target.value as 'lead' | 'assistant' } : event.target.value === 'lead' ? { ...item, role: 'assistant' } : item) })}><option value="lead">주강사</option><option value="assistant">강사</option></select>}</div>; })}</WizardSheet>}
    {sheet === 'schedule' && <WizardSheet title="반복 간격·건너뛸 날짜" onClose={() => setSheet(null)} footer={<button className="fl-btn primary cw-span2" onClick={() => setSheet(null)}>확인</button>}><Field title="반복 간격(주)"><WizardStepper label="반복 간격" value={schedule.recurrence_rule.interval_weeks} min={1} max={52} unit="주" onChange={interval_weeks => rule({ interval_weeks })} /></Field><Field title="건너뛸 날짜(쉼표로 구분, YYYY-MM-DD)"><input className="fl-input" aria-label="건너뛸 날짜" defaultValue={schedule.recurrence_rule.skip_dates.join(',')} onBlur={event => rule({ skip_dates: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /></Field>{schedule.schedule_mode === 'rolling' && <Field title="종료일(선택)"><input className="fl-input" aria-label="종료일" type="date" min={schedule.recurrence_rule.start_date} value={schedule.ends_on ?? ''} onChange={event => patch({ ends_on: event.target.value || null, rows: [] })} /></Field>}<p>공휴일은 자동으로 건너뛰지 않아요.</p></WizardSheet>}
    {sheet === 'conflicts' && <WizardSheet title="겹치는 일정" onClose={() => setSheet(null)} footer={<><button className="fl-btn soft" onClick={() => { setSheet(null); setStep(1); }}>시간 바꾸기</button><button className="fl-btn primary" onClick={() => setSheet(null)}>확인</button></>}><p>다른 강사나 시간을 정하거나, 겹치는 일정을 확인한 뒤 그대로 편성할 수 있어요.</p>{preview?.conflicts.map((item, index) => <div className="w-resrow" key={index}><span className="tx"><b>{item.visible && item.parent_title ? item.parent_title : '다른 일정'}</b><span>{item.kind === 'host' ? '지도사' : item.kind === 'member' ? '멤버' : '장소'} · {dateLabel(item.starts_at)} {timeLabel(item.starts_at)}</span></span></div>)}</WizardSheet>}
  </main>;
}
