import { useId, useState } from 'react';
import type { NarrativeField, NarrativeFieldKey, NarrativePatchRequest } from '../../lib/class-report/types';
import { sourceLabel, AI_SUMMARY_NOTICE } from '../../lib/class-report/narrative-fields';

interface Props {
  field: NarrativeFieldKey;
  value: NarrativeField;
  canEdit: boolean;
  onSave: (request: NarrativePatchRequest) => Promise<NarrativeField>;
  headline?: boolean;
  evidenceHref?: string;
}
function conflictValue(error: unknown): NarrativeField | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  const data = typeof record.data === 'object' && record.data !== null ? record.data as Record<string, unknown> : record;
  const detail = typeof data.detail === 'object' && data.detail !== null ? data.detail as Record<string, unknown> : data;
  const value = detail.value;
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).text === 'string' ? value as NarrativeField : null;
}
export function NarrativeText({ field, value, canEdit, onSave, headline = false, evidenceHref }: Props) {
  const id = useId();
  const [saved, setSaved] = useState<{ base: NarrativeField; response: NarrativeField } | null>(null);
  const shown = saved?.base === value ? saved.response : value;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [baseEditedAt, setBaseEditedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState('');
  const [latest, setLatest] = useState<NarrativeField | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const editable = canEdit && !forbidden;
  const empty = draft.trim().length === 0;
  const over = draft.trim().length > shown.max_len;
  const invalidControl = [...draft].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  async function submit(revert = false) {
    setBusy(true); setMessage('');
    try {
      const result = await onSave(revert ? { field, revert: true } : { field, text: draft.trim(), base_edited_at: baseEditedAt });
      setSaved({ base: value, response: result }); setEditing(false); setLatest(null); setConfirmRevert(false); setMessage('저장됨');
    } catch (error: unknown) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
      if (status === 403) { setForbidden(true); setEditing(false); setConfirmRevert(false); setMessage('수정 권한이 없어 읽기 전용으로 전환했어요.'); }
      else if (status === 409) { const current=conflictValue(error);setLatest(current);if(current)setBaseEditedAt(current.edited_at); setMessage('다른 곳에서 문장이 바뀌었어요. 최신본을 확인한 뒤 다시 저장해 주세요. 내 입력은 유지했어요.'); }
      else { setMessage('저장하지 못했어요. 입력은 유지돼요. 다시 시도해 주세요.'); }
    } finally { setBusy(false); }
  }
  const label = sourceLabel(shown);
  return <div className={`cr-narrative${headline ? ' cr-headline' : ''}`} data-narrative-field={field}>
    {headline ? <h1>{shown.text}</h1> : <p className="cr-story-copy">{shown.text}</p>}
    <div className="cr-source-row">{label && <span className="cr-source" title={shown.source==='ai'?AI_SUMMARY_NOTICE:undefined}>{label}</span>}{evidenceHref && <a href={evidenceHref}>근거 수치 보기 ↗</a>}{editable && !editing && <button type="button" onClick={() => { setDraft(shown.text); setBaseEditedAt(shown.edited_at); setEditing(true); setMessage(''); }}>수정</button>}</div>
    {shown.source === 'ai' && <p className="cr-caption">수업 통계를 바탕으로 AI가 정리한 문장이에요. 수치는 아래 카드의 값을 확인하세요.</p>}
    {shown.stale && <p className="cr-caption">수치가 바뀐 뒤 수정한 문장이에요</p>}
    {editing && editable && <div className="cr-editor"><label htmlFor={id}>서사 문장 수정</label><textarea id={id} value={draft} maxLength={shown.max_len} onChange={event => setDraft(event.target.value)} disabled={busy} aria-describedby={`${id}-count`} /><p id={`${id}-count`} className="cr-caption">남은 글자 {Math.max(0, shown.max_len - draft.length)}자 / 최대 {shown.max_len}자</p>{empty && <p className="cr-caption">문장을 입력해 주세요. 비우려면 초안으로 되돌려 주세요.</p>}{over && <p className="cr-caption">글자 수를 줄여 주세요.</p>}{invalidControl && <p className="cr-caption">줄바꿈과 제어문자를 제외하고 한 문장으로 입력해 주세요.</p>}<div className="cr-actions"><button type="button" disabled={busy || empty || over || invalidControl} onClick={() => void submit()}>저장</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setLatest(null); setMessage(''); }}>취소</button>{busy && <span role="status">저장 중…</span>}</div></div>}
    {editable && shown.source === 'edited' && !editing && <div className="cr-revert"><button type="button" onClick={() => setConfirmRevert(true)}>AI 초안으로 되돌리기</button>{confirmRevert && <div role="group" aria-label="초안으로 되돌리기 확인"><p>수정한 문장을 지우고 {shown.ai_draft ? 'AI 초안' : '자동 정리 문장'}으로 되돌릴까요?</p><div className="cr-actions"><button type="button" disabled={busy} onClick={() => void submit(true)}>되돌리기</button><button type="button" disabled={busy} onClick={() => setConfirmRevert(false)}>취소</button></div></div>}</div>}
    {message && <p role={latest || forbidden ? 'alert' : 'status'} className="cr-caption">{message}</p>}{latest && <div className="cr-latest"><strong>최신본</strong><p>{latest.text}</p></div>}
  </div>;
}
