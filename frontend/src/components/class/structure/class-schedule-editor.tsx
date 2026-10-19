import { useEffect, useRef, useState } from 'react';
import type { ClassDetailDto, ClassSessionDto } from '../../../lib/api/class-structure';
import { schedulingApi, type BulkCommand, type SchedulePreview, type ScheduleRow } from '../../../lib/api/class-scheduling';
import { operationKeys, schedulingError } from '../../../lib/class-structure/scheduling-model';
import { ApiError } from '../../../lib/api/client';
import { useAuthStore } from '../../../stores/authStore';
import './class-schedule-editor.css';
import { ClassSessionAdd } from './class-session-add';

interface Props { detail: ClassDetailDto; sessions: ClassSessionDto[]; onSaved: () => void }
const localTime = (value: string) => new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 16);
const labelTime = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
function rowFrom(session: ClassSessionDto): ScheduleRow | null {
  if (!session.scheduled_at || session.seq == null || session.state_version == null) return null;
  return { client_key: session.id, session_id: session.id, seq: session.seq, scheduled_at: session.scheduled_at,
    duration_min: session.duration_min ?? 60, location_type: session.location_type ?? 'online', location_address: session.location_address ?? null,
    host_id: session.host?.id ?? null, session_kind: session.session_kind === 'makeup' ? 'makeup' : 'regular', assignment_override: session.assignment_override ?? false,
    expected_state_version: session.state_version };
}
export function ClassScheduleEditor(props: Props) {
  const user = useAuthStore(state => state.user);
  if (props.detail.capabilities?.schedule !== true || props.detail.revision == null) return null;
  return <Editor key={`${user?.id}:${user?.role}:${props.detail.id}`} {...props} administrator={user?.role === 'org_admin'} />;
}
function Editor({ detail, sessions, onSaved, administrator }: Props & { administrator: boolean }) {
  const [dirty, setDirty] = useState(false);
  const [draftRevision, setDraftRevision] = useState(detail.revision);
  const draftConflict = dirty && draftRevision !== detail.revision;
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, ScheduleRow>>(() => Object.fromEntries(sessions.flatMap(session => { const row = rowFrom(session); return row ? [[session.id, row]] : []; })));
  const [preview, setPreview] = useState<{ command: BulkCommand; result: SchedulePreview } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [sheet, setSheet] = useState<ScheduleRow | null>(null);
  const [scope, setScope] = useState<'one' | 'selected' | 'following'>('one');
  const previewRequest = useRef<AbortController | null>(null);
  const locked = useRef(false); const alive = useRef(true); const keyFor = useRef(operationKeys()); const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; previewRequest.current?.abort(); }; }, []);
  useEffect(() => {
    if (dirty) return;
    setDraftRevision(detail.revision);
    setRows(Object.fromEntries(sessions.flatMap(session => { const row = rowFrom(session); return row ? [[session.id, row]] : []; })));
  }, [detail.revision, sessions, dirty]);
  const instructors = detail.host_view?.instructors.filter(item => item.status === 'active') ?? [];
  const editable = (session: ClassSessionDto) => ['ready', 'scheduled'].includes(session.status) && Boolean(rows[session.id]);
  function clearPreview() { setPreview(null); setConfirmed(false); setError(''); }
  function choose(id: string) { setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); clearPreview(); }
  async function execute(action: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) {
      if (alive.current) {
        setError(schedulingError(error)); setConfirmed(false);
        if (error instanceof ApiError) {
          const conflict = (error.data as { detail?: { code?: string; conflicts?: SchedulePreview['conflicts']; conflict_fingerprint?: string } } | null)?.detail;
          if (conflict?.code === 'schedule_conflict' && Array.isArray(conflict.conflicts) && conflict.conflict_fingerprint) setPreview(previous => previous ? { ...previous, result: { ...previous.result, conflicts: conflict.conflicts!, conflict_fingerprint: conflict.conflict_fingerprint! } } : null);
        }
      }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function inspect(action: BulkCommand['action']) {
    if (draftConflict) { setError('다른 변경이 있어요. 최신 편성을 확인한 뒤 다시 편집해 주세요.'); return; }
    if (!selected.length) { setError('변경할 회차를 선택해 주세요.'); return; }
    if (administrator && !reason.trim()) { setError('센터 관리자 대행 사유를 입력해 주세요.'); return; }
    const input = { action, expected_revision: draftRevision, session_ids: selected, expected_state_versions: Object.fromEntries(selected.map(id => [id, rows[id].expected_state_version!])), rows: action === 'replace' ? selected.map(id => rows[id]) : [], ...(reason.trim() ? { reason: reason.trim() } : {}) };
    const command: BulkCommand = { ...input, operation_key: keyFor.current(input) };
    await execute(async () => { previewRequest.current?.abort(); const controller = new AbortController(); previewRequest.current = controller; const result = await schedulingApi.previewBulk(detail.id, command, controller.signal); if (alive.current) { setPreview({ command, result }); setConfirmed(false); } });
  }
  async function save() {
    if (draftConflict) { setError('다른 변경이 있어요. 최신 편성을 확인한 뒤 다시 편집해 주세요.'); return; }
    if (!preview || preview.result.conflicts.some(item => item.kind !== 'place') && !confirmed) { setError('겹치는 일정을 확인해 주세요.'); return; }
    await execute(async () => {
      const { operation_key: _key, ...original } = preview.command;
      const body = { ...original, ...(confirmed ? { force: true, confirmed_conflict_fingerprint: preview.result.conflict_fingerprint } : {}) };
      await schedulingApi.bulk(detail.id, { ...body, operation_key: keyFor.current(body) });
      if (alive.current) { clearPreview(); setSelected([]); setDirty(false); onSaved(); }
    });
  }
  function closeSheet() { setSheet(null); lastFocus.current?.focus(); }
  function applySheet() {
    if (!sheet) return;
    if (!sheet.host_id || sheet.duration_min < 5 || sheet.duration_min > 480 || sheet.duration_min % 5 || sheet.location_type === 'offline' && !sheet.location_address?.trim()) { setError('진행 지도사·소요 시간·장소를 확인해 주세요.'); return; }
    const ids = scope === 'one' ? [sheet.session_id!] : scope === 'selected' ? [...new Set([...selected, sheet.session_id!])] : sessions.filter(session => editable(session) && (session.seq ?? 0) >= sheet.seq).map(session => session.id);
    const original = rows[sheet.session_id!];
    const difference = new Date(sheet.scheduled_at).getTime() - new Date(original.scheduled_at).getTime();
    const changes: Partial<ScheduleRow> = {};
    if (sheet.duration_min !== original.duration_min) changes.duration_min = sheet.duration_min;
    if (sheet.location_type !== original.location_type) {
      changes.location_type = sheet.location_type;
      changes.location_address = sheet.location_type === 'online' ? null : sheet.location_address;
    } else if (sheet.location_address !== original.location_address) changes.location_address = sheet.location_address;
    if (sheet.host_id !== original.host_id) { changes.host_id = sheet.host_id; changes.assignment_override = true; }
    setRows(previous => ({ ...previous, ...Object.fromEntries(ids.map(id => [id, {
      ...previous[id], ...changes,
      ...(difference ? { scheduled_at: new Date(new Date(previous[id].scheduled_at).getTime() + difference).toISOString() } : {}),
    }])) }));
    setSelected(ids); clearPreview(); closeSheet();
  }
  return <section className="ce-panel" aria-label="회차 일괄 편집" onChangeCapture={() => setDirty(true)}><header className="ce-heading"><div><h2>회차 일괄 편집</h2><p>회차를 고르고 한 번에 바꿔요. 저장하기 전에 변경 내용을 확인해요.</p></div><span>{selected.length}개 선택</span></header>
    {draftConflict && <p role="alert">다른 변경이 있어요. 입력을 보관 중이에요. 저장하려면 최신 편성을 확인해 주세요. <button type="button" onClick={() => { setSheet(null); setSelected([]); setReason(''); clearPreview(); setDirty(false); }}>입력 취소하고 최신 편성 불러오기</button></p>}
    {administrator && <label className="ce-reason">센터 관리자 대행 사유<input value={reason} maxLength={1000} disabled={busy} onChange={e => { setReason(e.target.value); clearPreview(); }} /></label>}
    <div className="ce-toolbar"><button disabled={busy} onClick={() => { setDirty(true); setSelected(sessions.filter(editable).map(session => session.id)); clearPreview(); }}>변경 가능한 회차 모두 선택</button><button disabled={busy || !selected.length} onClick={() => inspect('shift_week')}>한 주 밀기</button><button disabled={busy || !selected.length} onClick={() => inspect('replace')}>변경 내용 확인</button><button disabled={busy || !selected.length} onClick={() => inspect('cancel')}>선택 회차 취소</button></div>
    <div role="table" aria-label="편성 회차" className="ce-table"><div className="ce-columns" role="row">{['선택', '회차', '일시', '진행 지도사', '방식', '편집'].map(label => <span role="columnheader" key={label}>{label}</span>)}</div>{sessions.map(session => { const row = rows[session.id]; return <div className={`ce-row ${selected.includes(session.id) ? 'ce-selected' : ''}`} role="row" key={session.id}><span role="cell"><input type="checkbox" aria-label={`${session.seq}회차 선택`} checked={selected.includes(session.id)} disabled={busy || !editable(session)} onChange={() => choose(session.id)} /></span><strong role="cell">{session.seq}회차{session.session_kind === 'makeup' && <small>보강</small>}{session.host_state === 'needs_reassign' && <small className="ce-warning">재배정 필요</small>}</strong><span role="cell">{row ? labelTime(row.scheduled_at) : '일정 없음'}<small>{row?.duration_min ?? session.duration_min}분 · {session.status === 'completed' ? '완료' : session.status === 'cancelled' ? '취소' : session.status === 'in_progress' ? '진행 중' : '예정'}</small></span><span role="cell">{instructors.find(person => person.user_id === row?.host_id)?.name ?? (row?.host_id === session.host?.id ? session.host?.name : null) ?? '미정'}</span><span role="cell">{row?.location_type === 'offline' ? row.location_address : '온라인'}</span><span role="cell"><button disabled={busy || !editable(session)} onClick={() => { setDirty(true); lastFocus.current = document.activeElement as HTMLElement; setSheet({ ...row }); setScope('one'); clearPreview(); }} aria-label={`${session.seq}회차 편집`}>편집</button></span></div>; })}</div>
    {preview && <section className="ce-preview" aria-label="저장 전 확인"><h3>{preview.command.action === 'cancel' ? '선택한 회차를 취소해요' : '변경 전후를 확인해요'}</h3>{preview.command.session_ids.map(id => { const before = sessions.find(session => session.id === id)!; const after = preview.result.rows.find(row => row.session_id === id); return <div key={id} className="ce-diff"><strong>{before.seq}회차</strong>{preview.command.action === 'cancel' ? <p>{before.scheduled_at ? labelTime(before.scheduled_at) : '일정 없음'} → 취소</p> : after ? <dl>
      <div><dt>일시</dt><dd>{before.scheduled_at ? labelTime(before.scheduled_at) : '일정 없음'} → {labelTime(after.scheduled_at)}</dd></div>
      <div><dt>진행 지도사</dt><dd>{before.host?.name ?? '미정'} → {instructors.find(person => person.user_id === after.host_id)?.name ?? (after.host_id === before.host?.id ? before.host.name : '미정')}</dd></div>
      <div><dt>소요 시간</dt><dd>{before.duration_min ?? 60}분 → {after.duration_min}분</dd></div>
      <div><dt>장소</dt><dd>{before.location_type === 'offline' ? before.location_address ?? '장소 미정' : '온라인'} → {after.location_type === 'offline' ? after.location_address ?? '장소 미정' : '온라인'}</dd></div>
    </dl> : <p>변경 없음</p>}</div>; })}{preview.result.conflicts.map((conflict, index) => <p className="ce-warning" key={index}>{conflict.kind === 'place' ? '장소' : conflict.kind === 'host' ? '지도사' : '멤버'} 일정 겹침 · {conflict.visible && conflict.parent_title ? conflict.parent_title : '다른 일정'}</p>)}{preview.result.conflicts.some(item => item.kind !== 'place') && <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />겹치는 일정을 확인했고 그대로 변경해요</label>}<div className="ce-toolbar"><button disabled={busy} onClick={clearPreview}>편집으로 돌아가기</button><button className="ce-primary" disabled={busy} onClick={save}>변경 저장</button></div></section>}
    {(detail.status === 'active' || detail.status === 'completed' && detail.schedule_mode === 'fixed') && <ClassSessionAdd detail={{...detail,revision:draftRevision}} sessions={sessions} onSaved={onSaved} />}
    {error && <p role="alert" className="ce-error">{error}</p>}
    {sheet && <div className="ce-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="ce-sheet-title" className="ce-sheet" onKeyDown={event => { if (event.key === 'Escape') closeSheet(); if (event.key === 'Tab') { const elements = event.currentTarget.querySelectorAll<HTMLElement>('input,select,button'); const first = elements[0]; const last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }}><h3 id="ce-sheet-title">{sheet.seq}회차 편집</h3><label>일시<input autoFocus type="datetime-local" value={localTime(sheet.scheduled_at)} step={300} onChange={e => { if (e.target.value) setSheet({ ...sheet, scheduled_at: `${e.target.value}:00+09:00` }); }} /></label><label>소요 시간(분)<input type="number" min={5} max={480} step={5} value={sheet.duration_min} onChange={e => setSheet({ ...sheet, duration_min: Number(e.target.value) })} /></label><label>진행 지도사<select value={sheet.host_id ?? ''} onChange={e => setSheet({ ...sheet, host_id: e.target.value || null })}><option value="">미정</option>{instructors.map(person => <option value={person.user_id} key={person.user_id}>{person.name ?? '이름 없음'}</option>)}</select></label><label>진행 방식<select value={sheet.location_type} onChange={e => setSheet({ ...sheet, location_type: e.target.value as 'online' | 'offline' })}><option value="online">온라인</option><option value="offline">오프라인</option></select></label>{sheet.location_type === 'offline' && <label>장소<input value={sheet.location_address ?? ''} onChange={e => setSheet({ ...sheet, location_address: e.target.value })} /></label>}<label>적용 범위<select value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="one">이 회차만</option><option value="selected">선택한 회차 모두</option><option value="following">이 회차 이후 모두</option></select></label><p>바꾼 항목만 적용해요. 여러 회차의 일시는 같은 간격만큼 이동하고 나머지 배정과 장소는 유지해요. 아직 서버에 저장하지 않아요.</p>{error && <p role="alert" className="ce-error">{error}</p>}<div className="ce-toolbar"><button onClick={closeSheet}>닫기</button><button className="ce-primary" onClick={applySheet}>편집 내용 적용</button></div></section></div>}
  </section>;
}
