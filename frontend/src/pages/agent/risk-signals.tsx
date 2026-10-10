import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { handleRiskSignal, listRiskSignals, type RiskSignal } from '../../lib/api/agent-checkin';
import { useCounselorAgentStore } from '../../stores/agent-counselor-store';

// 테스트에서 정렬 로직을 단독 검증하므로 컴포넌트와 함께 내보낸다.
// eslint-disable-next-line react-refresh/only-export-components
export function sortRiskSignals(items: RiskSignal[]): RiskSignal[] {
  return [...items].sort((a, b) => Number(Boolean(a.handled_at)) - Number(Boolean(b.handled_at)) || b.created_at.localeCompare(a.created_at));
}

export default function RiskSignals() {
  const [items, setItems] = useState<RiskSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching || lock.current) return;
      fetching = true;
      const version = revision.current;
      try {
        const [open, all] = await Promise.all([listRiskSignals('open'), listRiskSignals('all')]);
        const result = { items: [...new Map([...all.items, ...open.items].map((item) => [item.id, item])).values()] };
        if (active && version === revision.current) { setItems(result.items); setError(''); }
      } catch { if (active) setError('위험 신호를 불러오지 못했습니다.'); }
      finally { fetching = false; if (active) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [reload]);
  return <section aria-label="위험 신호 목록" className="min-h-0 flex-1 space-y-3 overflow-y-auto">
    {loading && <p role="status">불러오는 중…</p>}
    {error && <p role="alert">{error} <button className="underline" onClick={() => setReload((value) => value + 1)}>다시 시도</button></p>}
    {!loading && !error && !items.length && <p className="py-8 text-center text-sm">위험 신호가 없습니다.</p>}
    {sortRiskSignals(items).map((item) => <article key={item.id} className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link to={`/clients/${encodeURIComponent(item.client_id)}`} className="font-bold">{item.client_name}</Link>
        <span className="rounded-full bg-white px-2 py-1 text-sm">{item.level === 'high' ? '긴급' : '주의'} · {item.handled_at ? '처리 완료' : '미처리'}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm">{item.excerpt}</p>
      <time className="block text-xs" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('ko-KR')}</time>
      {!item.handled_at && <button disabled={busy} className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40" onClick={async () => {
        if (lock.current) return;
        lock.current = true; revision.current += 1; setBusy(true); setError('');
        try {
          const updated = await handleRiskSignal(item.id);
          setItems((previous) => previous.map((entry) => entry.id === updated.id ? updated : entry));
          if (updated.handled_at) useCounselorAgentStore.getState().decrementOpenRisk();
        } catch { setError('처리 상태를 저장하지 못했습니다. 다시 시도해 주세요.'); }
        finally { lock.current = false; setBusy(false); }
      }}>처리 완료</button>}
    </article>)}
  </section>;
}
