import { useEffect, useRef, useState } from 'react';
import * as api from '../../lib/api/agent-checkin';
import type { CheckinClient, CheckinSummary, ProfileItem, ProfilePatch } from '../../lib/api/agent-checkin';

const profileCategoryLabels: Record<ProfileItem['category'], string> = {
  sleep: '수면', stress: '스트레스 요인', emotion: '감정 표현', coping: '대처 방식', people_events: '주요 인물·사건',
};
const moodLabels = { better: '좋아짐', same: '비슷함', watch: '주의' };
const buttonClass = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-40';

export function ProfileItemView({ item, busy, onPatch }: {
  item: ProfileItem; busy: boolean; onPatch: (patch: ProfilePatch) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  if (item.status === 'dismissed') return null;
  return <article className="space-y-2 rounded-xl border p-3">
    <span className="rounded-full bg-[#F5EDFC] px-2 py-1 text-xs">{item.status === 'ai_estimate' ? 'AI 추정' : '확정'}</span>
    <p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>
    <p className="text-xs text-gray-500">근거 {item.evidence_count}개</p>
    {editing ? <form onSubmit={async (event) => {
      event.preventDefault(); if (!text.trim() || text.trim().length > 300) return;
      try { await onPatch({ text: text.trim() }); setEditing(false); } catch { /* 상위 카드에서 오류를 표시한다. */ }
    }} className="space-y-2">
      <textarea aria-label="프로파일 내용 수정" value={text} onChange={(event) => setText(event.target.value)} maxLength={300} required disabled={busy} className="w-full rounded-lg border p-2" />
      <div className="flex gap-2"><button disabled={busy || !text.trim()} className={buttonClass}>저장</button><button type="button" disabled={busy} onClick={() => setEditing(false)} className={buttonClass}>취소</button></div>
    </form> : <div className="flex gap-2">
      {item.status === 'ai_estimate' && <button disabled={busy} className={buttonClass} onClick={() => void onPatch({ status: 'confirmed' }).catch(() => {})}>확정</button>}
      <button disabled={busy} className={buttonClass} onClick={() => { setText(item.text); setEditing(true); }}>수정</button>
      <button disabled={busy} className={buttonClass} onClick={() => void onPatch({ status: 'dismissed' }).catch(() => {})}>기각</button>
    </div>}
  </article>;
}

export default function AgentCheckinPanel({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<CheckinClient | null>(null);
  const [items, setItems] = useState<ProfileItem[]>([]);
  const [checkins, setCheckins] = useState<CheckinSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setClient(null); setItems([]); setCheckins([]);
    void Promise.all([api.listCheckinClients(), api.getProfile(clientId), api.listCheckins(clientId)])
      .then(([clients, profile, summaries]) => {
        if (!active) return;
        setClient(clients.items.find((item) => item.client_id === clientId) ?? null);
        setItems(profile.items); setCheckins(summaries.items);
      }).catch(() => { if (active) setError('AI 안부 정보를 불러오지 못했습니다.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId, reload]);
  const mutate = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (err) { setError('변경을 저장하지 못했습니다. 다시 시도해 주세요.'); throw err; }
    finally { lock.current = false; setBusy(false); }
  };
  return <section aria-label="AI 안부 대화" className="mb-6 space-y-5 rounded-lg border border-gray-200 bg-white p-6">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">AI 안부 대화</h2>
      {client && <label className="flex items-center gap-2 text-sm">{client.enabled ? '켜짐' : '꺼짐'}<input aria-label="AI 안부 대화 켜기" type="checkbox" role="switch" checked={client.enabled} disabled={busy} onChange={(event) => {
        const enabled = event.target.checked;
        void mutate(async () => setClient(await api.setCheckinEnabled(clientId, enabled))).catch(() => {});
      }} /></label>}
    </div>
    {loading && <p role="status">불러오는 중…</p>}
    {error && <p role="alert">{error} <button onClick={() => setReload((value) => value + 1)} className="underline">다시 시도</button></p>}
    {client && <p className="text-sm text-gray-500">마지막 안부: {client.last_checkin_at ? new Date(client.last_checkin_at).toLocaleString('ko-KR') : '아직 없음'}</p>}
    <h3 className="font-semibold">상담사 전용 프로파일</h3>
    {Object.entries(profileCategoryLabels).map(([category, label]) => <section key={category} className="space-y-2">
      <h4 className="text-sm font-semibold">{label}</h4>
      {!items.some((item) => item.category === category && item.status !== 'dismissed') && <p className="text-sm text-gray-500">아직 정리된 내용이 없습니다.</p>}
      {items.filter((item) => item.category === category).map((item) => <ProfileItemView key={item.id} item={item} busy={busy} onPatch={(patch) => mutate(async () => {
        const updated = await api.patchProfileItem(item.id, patch);
        setItems((previous) => previous.map((entry) => entry.id === updated.id ? updated : entry));
      })} />)}
    </section>)}
    <h3 className="font-semibold">안부 요약</h3>
    {!loading && !checkins.length && <p className="text-sm text-gray-500">아직 안부 요약이 없습니다.</p>}
    <ol className="space-y-3">{checkins.map((checkin) => <li key={checkin.id} className="border-l-2 border-[#5F0080]/20 pl-3">
      <time className="text-xs text-gray-500" dateTime={checkin.started_at}>{new Date(checkin.started_at).toLocaleString('ko-KR')}</time>
      {checkin.mood_direction && <span className="ml-2 rounded-full bg-[#F5EDFC] px-2 py-1 text-xs">{moodLabels[checkin.mood_direction]}</span>}
      <p className="mt-2 whitespace-pre-wrap text-sm">{checkin.summary || '안부 대화 중입니다.'}</p>
    </li>)}</ol>
  </section>;
}
