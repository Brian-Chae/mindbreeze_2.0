import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useWizardLeaveGuard } from '../../hooks/useWizardLeaveGuard';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import { getClass } from '../../lib/api/class-structure';
import { asClassId } from '../../lib/class-structure/read-model';
import { schedulingApi, type ScheduleInput, type SchedulePreview, type InstructorCandidate, type WriteResult } from '../../lib/api/class-scheduling';
import { defaultSchedule, koreanToday, operationKeys, parseInviteEmails, parseInviteCsv, scheduleProblems, schedulingError } from '../../lib/class-structure/scheduling-model';
import './class-scheduling.css';

const steps = ['기본 정보', '일정 형태', '강사 배정', '초대·확인'];
const days = ['월', '화', '수', '목', '금', '토', '일'];
function Field({ title, children }: { title: string; children: ReactNode }) { return <label className="cs-field"><span>{title}</span>{children}</label>; }
export function ClassSchedulingWizard() {
  const user = useAuthStore(state => state.user);
  const [search] = useSearchParams();
  return user ? <Wizard key={`${user.id}:${search.toString()}`} user={user} draftId={search.get('draft')} copyId={search.get('copy')} /> : null;
}
function Wizard({ user, draftId, copyId }: { user: { id: string; role: string }; draftId: string | null; copyId: string | null }) {
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState(() => defaultSchedule(user.role === 'counselor' ? user.id : null));
  const [step, setStep] = useState(0);
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
      if (status === 'draft') { bypass(); navigate(`/classes/${result.class_id}`); return; }
      setCreated(result);
      const detail = await getClass(asClassId(result.class_id)).catch(() => null);
      if (alive.current) setCode(detail?.host_view?.access_code ?? null);
      if (alive.current) await sendInvitations(result);
    });
  }
  async function duplicate() {
    if (!copyId || copyDate < koreanToday()) { setError('시작 날짜는 오늘 이후로 정해 주세요.'); return; }
    await execute(async () => {
      const payload = { start_date: copyDate, invite_members: copyMembers, expected_revision: sourceRevision.current };
      const result = await schedulingApi.duplicate(copyId, { ...payload, operation_key: keyFor.current({ copyId, ...payload }) });
      if (alive.current) { bypass(); navigate(`/classes/new?draft=${encodeURIComponent(result.class_id)}`, { replace: true }); }
    });
  }
  const hostOptions = <><option value="">미정</option>{schedule.instructors.map(person => <option key={person.user_id} value={person.user_id}>{candidates.find(x => x.id === person.user_id)?.name ?? '이름 없음'}</option>)}</>;
  const dateLabel = (date: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));

  return <main className="cs-wizard"><header className="cs-top"><Link to="/classes" onClick={event => { if (dirty && !created) { event.preventDefault(); setLeave(true); } }}>MIND BREEZE <span>명상 클래스</span></Link><button onClick={() => dirty && !created ? setLeave(true) : navigate('/classes')}>나가기</button></header>
    {created ? <section className="cs-card cs-done"><span className="cs-eyebrow">편성 완료</span><h1>클래스를 만들었어요</h1><p>{schedule.title} · {created.session_ids?.length ?? preview?.rows.length ?? 0}회차</p><p>클래스 코드</p><strong className="cs-code">{code ?? '상세에서 확인'}</strong><p>코드는 클래스가 끝날 때까지 같아요. 멤버에게만 전달해 주세요.</p>{inviteState === 'pending' && <p role="status">이메일 전달을 요청했어요. 발송 상태는 멤버 탭에서 확인할 수 있어요.</p>}{inviteState === 'failed' && <div role="alert"><p>클래스는 저장됐지만 이메일 초대 요청을 완료하지 못했어요.</p><button disabled={busy} onClick={() => execute(() => sendInvitations(created))}>초대 요청 다시 시도</button></div>}<Link className="cs-primary" to={`/classes/${created.class_id}`}>클래스 보기</Link></section> : copyId && !copyReady ? <section className="cs-card"><h1>지난 기수 그대로 시작해요</h1><p>원래 요일·시각·강사 배정을 가져와 새 초안으로 만들어요. 취소·보강·개별 이동은 복사하지 않아요.</p><Field title="새 시작 날짜"><input type="date" value={copyDate} min={koreanToday()} onChange={e => setCopyDate(e.target.value)} /></Field><label className="cs-check"><input type="checkbox" checked={copyMembers} onChange={e => setCopyMembers(e.target.checked)} />기존 멤버도 새로 초대해요</label><p>이전 고지 확인과 동의는 복사하지 않아요.</p>{error && <p role="alert">{error}</p>}<button className="cs-primary" disabled={busy || !available} onClick={duplicate}>초안 만들기</button><button onClick={() => setCopyReady(true)}>직접 입력하기</button></section> : <>
      <ol className="cs-steps" aria-label="편성 단계">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
      <div className="cs-layout"><section className="cs-card"><span className="cs-eyebrow">{step + 1} / 4</span><h1>{['기본 정보를 정해요', '언제 진행할까요?', '누가 진행할까요?', '초대하고 확인해요'][step]}</h1>
      <fieldset disabled={busy || !available} className="cs-form">
      {step === 0 && <><Field title="클래스 이름"><input name="title" value={schedule.title} maxLength={200} onChange={e => patch({ title: e.target.value })} placeholder="예: 퇴근 후 마음 명상" /></Field><div className="cs-options">{(['online', 'offline'] as const).map(mode => <button key={mode} type="button" aria-pressed={schedule.location_type === mode} onClick={() => patch({ location_type: mode, record_video: mode === 'offline' ? false : schedule.record_video, rows: [] })}>{mode === 'online' ? '온라인' : '오프라인'}</button>)}</div>{schedule.location_type === 'offline' && <Field title="장소"><input value={schedule.location_address ?? ''} maxLength={300} onChange={e => patch({ location_address: e.target.value, rows: [] })} /></Field>}<Field title="정원"><input name="capacity" type="number" min={2} max={schedule.location_type === 'online' ? 50 : 100} value={schedule.capacity} onChange={e => patch({ capacity: Number(e.target.value) })} /></Field><details><summary>추가 설정 · LINK BAND·녹음·채팅</summary><label className="cs-check"><input type="checkbox" checked={schedule.linkband_mode === 'optional'} onChange={e => patch({ linkband_mode: e.target.checked ? 'optional' : 'none' })} />LINK BAND 선택 사용</label><label className="cs-check"><input type="checkbox" checked={schedule.record_audio} onChange={e => patch({ record_audio: e.target.checked })} />음성 녹음</label>{schedule.location_type === 'online' && <label className="cs-check"><input type="checkbox" checked={schedule.record_video} onChange={e => patch({ record_video: e.target.checked })} />영상 녹화</label>}<label className="cs-check"><input type="checkbox" checked={schedule.chat_enabled} onChange={e => patch({ chat_enabled: e.target.checked })} />채팅</label></details></>}
      {step === 1 && <><div className="cs-options">{(['fixed', 'rolling'] as const).map(mode => <button type="button" key={mode} aria-pressed={schedule.schedule_mode === mode} onClick={() => patch({ schedule_mode: mode, rows: [] })}>{mode === 'fixed' ? '정해진 횟수' : '계속 이어져요'}</button>)}</div><div className="cs-grid"><Field title="시작 날짜"><input type="date" min={koreanToday()} value={schedule.recurrence_rule.start_date} onChange={e => rule({ start_date: e.target.value })} /></Field><Field title="시작 시각"><input type="time" min="07:00" max="22:00" step={300} value={schedule.recurrence_rule.time} onChange={e => rule({ time: e.target.value })} /></Field><Field title="소요 시간(분)"><input type="number" min={5} max={480} step={5} value={schedule.duration_min} onChange={e => patch({ duration_min: Number(e.target.value), rows: [] })} /></Field>{schedule.schedule_mode === 'fixed' ? <Field title="횟수"><input type="number" min={2} max={52} value={schedule.planned_session_count} onChange={e => patch({ planned_session_count: Number(e.target.value), rows: [] })} /></Field> : <Field title="종료일(선택)"><input type="date" min={schedule.recurrence_rule.start_date} value={schedule.ends_on ?? ''} onChange={e => patch({ ends_on: e.target.value || null, rows: [] })} /></Field>}<Field title="반복 간격(주)"><input type="number" min={1} max={52} value={schedule.recurrence_rule.interval_weeks} onChange={e => rule({ interval_weeks: Number(e.target.value) })} /></Field><Field title="예약 알림"><select value={schedule.reminder_offsets.join(',')} onChange={e => patch({ reminder_offsets: e.target.value ? e.target.value.split(',').map(Number) : [] })}><option value="">끄기</option><option value="1440">하루 전</option><option value="60">1시간 전</option><option value="1440,60">둘 다</option></select></Field></div><div className="cs-days" role="group" aria-label="요일">{days.map((day, i) => <button type="button" key={day} aria-pressed={schedule.recurrence_rule.weekdays.includes(i + 1)} onClick={() => rule({ weekdays: schedule.recurrence_rule.weekdays.includes(i + 1) ? schedule.recurrence_rule.weekdays.filter(n => n !== i + 1) : [...schedule.recurrence_rule.weekdays, i + 1].sort() })}>{day}</button>)}</div><Field title="건너뛸 날짜(쉼표로 구분, YYYY-MM-DD)"><input defaultValue={schedule.recurrence_rule.skip_dates.join(',')} onBlur={e => rule({ skip_dates: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} /></Field><p className="cs-note">{schedule.schedule_mode === 'rolling' ? '처음 4주 분량을 만들고 이후 일정은 자동으로 이어져요.' : '선택한 요일의 일정을 한 번에 만들어요.'} 공휴일은 자동으로 건너뛰지 않아요.</p></>}
      {step === 2 && <><div className="cs-instructors">{schedule.instructors.map((person, i) => <div key={person.user_id}><span>{candidates.find(x => x.id === person.user_id)?.name ?? '이름 없음'}</span><select aria-label={`${i + 1}번째 강사 역할`} value={person.role} onChange={e => patch({ instructors: schedule.instructors.map(x => x.user_id === person.user_id ? { ...x, role: e.target.value as 'lead' | 'assistant' } : x) })}><option value="lead">주강사</option><option value="assistant">강사</option></select><button type="button" onClick={() => patch({ instructors: schedule.instructors.filter(x => x.user_id !== person.user_id), assignment_rule: { ...schedule.assignment_rule, host_ids: schedule.assignment_rule.host_ids.filter(id => id !== person.user_id), weekday_hosts: Object.fromEntries(Object.entries(schedule.assignment_rule.weekday_hosts).map(([day, id]) => [day, id === person.user_id ? null : id])) }, rows: [] })}>제외</button></div>)}</div><Field title="강사 추가"><select value="" onChange={e => { const id = e.target.value; if (id) patch({ instructors: [...schedule.instructors, { user_id: id, role: schedule.instructors.length ? 'assistant' : 'lead' }], assignment_rule: { ...schedule.assignment_rule, host_ids: schedule.assignment_rule.mode === 'rotate' ? [...schedule.assignment_rule.host_ids, id] : schedule.assignment_rule.mode === 'all_one' ? [schedule.assignment_rule.host_ids[0] ?? id] : schedule.assignment_rule.host_ids }, rows: [] }); }}><option value="">같은 센터 지도사 선택</option>{candidates.filter(person => !schedule.instructors.some(x => x.user_id === person.id)).map(person => <option key={person.id} value={person.id}>{person.name ?? '이름 없음'}</option>)}</select></Field><Field title="배정 방식"><select value={schedule.assignment_rule.mode} onChange={e => patch({ assignment_rule: { ...schedule.assignment_rule, mode: e.target.value as ScheduleInput['assignment_rule']['mode'], host_ids: e.target.value === 'per_session' || e.target.value === 'by_weekday' ? [] : e.target.value === 'all_one' ? [schedule.instructors[0]?.user_id ?? null] : schedule.instructors.map(x => x.user_id), weekday_hosts: Object.fromEntries(schedule.recurrence_rule.weekdays.map(day => [day, schedule.assignment_rule.weekday_hosts[day] ?? null])) }, rows: [] })}><option value="all_one">모두 한 분이 맡아요</option><option value="rotate">번갈아 맡아요</option><option value="by_weekday">요일마다 달라요</option><option value="per_session">회차마다 직접 정해요</option></select></Field>{schedule.assignment_rule.mode === 'all_one' && <Field title="진행 지도사"><select value={schedule.assignment_rule.host_ids[0] ?? ''} onChange={e => patch({ assignment_rule: { ...schedule.assignment_rule, host_ids: [e.target.value || null] }, rows: [] })}>{hostOptions}</select></Field>}{schedule.assignment_rule.mode === 'rotate' && schedule.assignment_rule.host_ids.map((id, index) => <div className="cs-order" key={`${id}:${index}`}><span>{index + 1}. {candidates.find(x => x.id === id)?.name ?? '미정'}</span><button type="button" disabled={index === 0} onClick={() => { const ids = [...schedule.assignment_rule.host_ids]; [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; patch({ assignment_rule: { ...schedule.assignment_rule, host_ids: ids }, rows: [] }); }}>위로</button></div>)}{schedule.assignment_rule.mode === 'by_weekday' && schedule.recurrence_rule.weekdays.map(day => <Field title={`${days[day - 1]}요일 지도사`} key={day}><select value={schedule.assignment_rule.weekday_hosts[day] ?? ''} onChange={e => patch({ assignment_rule: { ...schedule.assignment_rule, weekday_hosts: { ...schedule.assignment_rule.weekday_hosts, [day]: e.target.value || null } }, rows: [] })}>{hostOptions}</select></Field>)}<button type="button" onClick={() => inspect(false)}>일정 확인</button>{(preview || schedule.rows.length > 0) && <div className="cs-rows">{(preview?.rows ?? schedule.rows).map(row => <div key={row.client_key}><span><strong>{row.seq}회차</strong><small>{dateLabel(row.scheduled_at)} · {row.duration_min}분</small></span><select aria-label={`${row.seq}회차 진행 지도사`} value={row.host_id ?? ''} onChange={e => patch({ rows: (preview?.rows ?? schedule.rows).map(item => item.client_key === row.client_key ? { ...item, host_id: e.target.value || null, assignment_override: true } : item) })}>{hostOptions}</select></div>)}</div>}</>}
      {step === 3 && <><Field title="초대 이메일(선택)"><textarea value={emails} onChange={e => { setEmails(e.target.value); setDirty(true); }} placeholder="이메일을 쉼표 또는 줄바꿈으로 구분해 주세요" /></Field><Field title="CSV로 이메일 가져오기"><input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1024 * 1024) { setError('CSV 파일은 1MB 이하로 올려 주세요.'); return; } try { const imported = parseInviteCsv(await file.text()); if (alive.current) { setEmails(imported.join('\n')); setDirty(true); setError(''); } } catch (error) { if (alive.current) setError(error instanceof Error && error.message.startsWith('CSV') ? error.message : 'CSV 파일을 읽지 못했어요. UTF-8 이메일 파일을 확인해 주세요.'); } }} /></Field><p>초대는 건너뛰어도 돼요. 만든 뒤 클래스 코드로 멤버가 합류할 수 있어요.</p><div className="cs-note"><strong>{schedule.title}</strong><p>{preview?.rows.length ?? 0}회차 · 정원 {schedule.capacity}명 · {schedule.location_type === 'online' ? '온라인' : schedule.location_address}</p><p>이메일 초대 {parseInviteEmails(emails).length}명 · 발송 결과는 저장 후 따로 확인해요.</p></div>{preview?.rows.map(row => <div className="cs-review-row" key={row.client_key}><strong>{row.seq}회차</strong><span>{dateLabel(row.scheduled_at)}</span><span>{candidates.find(x => x.id === row.host_id)?.name ?? '미정'}</span></div>)}</>}
      {user.role === 'org_admin' && <Field title="센터 관리자 대행 사유"><textarea maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); setDirty(true); }} placeholder="초안 수정·공개·초대 사유를 입력해 주세요" /></Field>}
      </fieldset>
      {preview && preview.conflicts.length > 0 && <section className="cs-warning" aria-label="겹치는 일정"><h2>겹치는 일정 {preview.conflicts.length}건</h2>{preview.conflicts.map((item, index) => <p key={index}>{item.kind === 'host' ? '지도사' : item.kind === 'member' ? '멤버' : '장소'} · {dateLabel(item.starts_at)} · {item.visible && item.parent_title ? item.parent_title : '다른 일정'}</p>)}{preview.conflicts.some(item => item.kind !== 'place') && <label className="cs-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />겹치는 일정을 확인했고 그대로 편성해요</label>}</section>}
      {error && <p className="cs-error" role="alert">{error}</p>}
      <footer className="cs-footer">{step > 0 && <button disabled={busy} onClick={() => { setStep(step - 1); setError(''); }}>이전</button>}<button data-save-draft disabled={busy || !available} onClick={() => save('draft')}>초안 저장</button>{step < 3 ? <button className="cs-primary" disabled={busy || !available} onClick={next}>다음</button> : <button className="cs-primary" disabled={busy || !available} onClick={() => save('active')}>{busy ? '저장 중…' : '클래스 만들기'}</button>}</footer>
      </section><aside className="cs-sidebar"><span className="cs-eyebrow">나만의 명상 클래스</span><h2>함께할 시간을<br />하나씩 정해요</h2><p>횟수와 요일을 정하고 강사를 배정하면 모든 회차를 한 번에 만들 수 있어요.</p><div><strong>{schedule.title || '새 클래스'}</strong><p>{schedule.schedule_mode === 'fixed' ? `${schedule.planned_session_count}회` : '계속 이어지는 정기형'} · {schedule.duration_min}분</p><p>{schedule.instructors.length}명의 지도사 · {schedule.capacity}명 정원</p></div><p className="cs-note">미정인 회차는 초안으로 저장하고 이어서 편성할 수 있어요.</p></aside></div>
    </>}
    {(leave || blocker.state === 'blocked') && <div className="cs-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="cs-leave-title" className="cs-card"><h2 id="cs-leave-title">만들기를 그만둘까요?</h2><p>저장하지 않은 입력은 사라져요.</p><button autoFocus onClick={() => { setLeave(false); if (blocker.state === 'blocked') blocker.reset(); }}>계속 만들기</button><button onClick={() => { bypass(); if (blocker.state === 'blocked') blocker.proceed(); else navigate('/classes'); }}>나가기</button></section></div>}
  </main>;
}
