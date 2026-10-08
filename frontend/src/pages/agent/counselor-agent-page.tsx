import RiskSignals from './risk-signals';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import * as api from '../../lib/api/agent-counselor';
import type { CounselorMessage, RelayEvent } from '../../lib/api/agent-counselor';
import { useCounselorAgentStore } from '../../stores/agent-counselor-store';
import BriefingSettingsSheet from './briefing-settings-sheet';
import { feedbackLabel, mergeMessages, resolveCounselorCta, sortRelayEvents } from './counselor-agent-utils';

export default function CounselorAgentPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const riskTab = params.get('tab') === 'risk';
  const openRisk = useCounselorAgentStore((state) => state.openRisk);
  const relayTab = params.get('tab') === 'relay';
  const [messages, setMessages] = useState<CounselorMessage[]>([]);
  const [events, setEvents] = useState<RelayEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const historyLoaded = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fail = useCallback((err: unknown) => setError(err instanceof Error ? err.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.'), []);
  useEffect(() => {
    if (riskTab) { setLoading(false); return; }
    let active = true;
    let fetching = false;
    setLoading(true);
    const refresh = async () => {
      if (fetching || lock.current) return;
      fetching = true;
      try {
        if (relayTab) {
          const result = await api.listRelayEvents();
          if (active) setEvents(result.items);
        } else {
          const result = await api.listMessages();
          if (!active) return;
          setMessages((previous) => mergeMessages(previous, result.items));
          if (!historyLoaded.current) { setHasMore(result.has_more); historyLoaded.current = true; }
          if (document.visibilityState === 'visible' && result.items[0]) {
            const read = await api.markRead(result.items[0].created_at);
            if (active) useCounselorAgentStore.getState().setUnread(read.unread);
          }
        }
      } catch (err) { if (active) fail(err); }
      finally { fetching = false; if (active) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [relayTab, riskTab, reload, fail]);
  const latestId = messages.at(-1)?.id;
  useEffect(() => { if (!relayTab) bottom.current?.scrollIntoView?.({ block: 'end' }); }, [latestId, relayTab]);
  const perform = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (err) { fail(err); }
    finally { lock.current = false; setBusy(false); }
  };
  const loadOlder = async () => {
    if (olderBusy) return;
    setOlderBusy(true);
    const height = scroller.current?.scrollHeight ?? 0;
    const top = scroller.current?.scrollTop ?? 0;
    try {
      const result = await api.listMessages(messages[0]?.created_at);
      setMessages((previous) => mergeMessages(previous, result.items)); setHasMore(result.has_more);
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = top + scroller.current.scrollHeight - height; });
    } catch (err) { fail(err); } finally { setOlderBusy(false); }
  };
  return <AppShell title="AI 대화" sub="AI ASSISTANT" noScroll rightSlot={<button onClick={() => setSettingsOpen(true)} className="rounded-xl border bg-white px-4 py-2 text-sm">브리핑 설정</button>}>
    <div className="mx-auto flex h-full min-h-0 max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap gap-2" aria-label="AI 채널 메뉴">
        <button aria-pressed={!relayTab && !riskTab} onClick={() => setParams({})} className={`rounded-xl px-4 py-2 ${!relayTab && !riskTab ? 'bg-[#5F0080] text-white' : 'bg-white'}`}>대화·브리핑</button>
        <button aria-pressed={relayTab} onClick={() => setParams({ tab: 'relay' })} className={`rounded-xl px-4 py-2 ${relayTab ? 'bg-[#5F0080] text-white' : 'bg-white'}`}>내담자 피드백·일정 변경 문의</button>
        <button aria-pressed={riskTab} onClick={() => setParams({ tab: 'risk' })} className={`rounded-xl px-4 py-2 ${riskTab ? 'bg-[#5F0080] text-white' : 'bg-white'}`}>위험 신호{openRisk > 0 ? ` · 미처리 ${openRisk}` : ''}</button>
      </div>
      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}<button onClick={() => { setError(''); setReload((value) => value + 1); }} className="ml-2 underline">다시 시도</button></div>}
      {loading && <p role="status">불러오는 중…</p>}
      {riskTab ? <RiskSignals /> : relayTab ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {!loading && !events.length && <p className="py-8 text-center text-sm">아직 전달된 피드백이나 문의가 없습니다.</p>}
        {sortRelayEvents(events).map((item) => <article key={item.id} className="rounded-2xl bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><Link to={`/clients/${encodeURIComponent(item.client_id)}`} className="font-bold text-[#5F0080]">{item.client_name}</Link><span className="text-xs text-[#6F6F6F]">{item.handled_at ? '처리 완료' : '미처리'}</span></div>
          <h2 className="my-2 font-semibold">{item.kind === 'feedback' ? feedbackLabel(item.payload.choice) : item.kind === 'ack' ? '일정 확인' : '일정 변경 문의'}</h2>
          {item.session_title && <p className="text-sm">{item.session_title}</p>}
          {item.scheduled_at && <time className="text-xs text-[#6F6F6F]" dateTime={item.scheduled_at}>{new Date(item.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>}
          {item.payload.texts?.map((content, index) => <p key={index} className="mt-3 whitespace-pre-wrap break-words text-sm">{content}</p>)}
          {item.payload.reason && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.payload.reason}</p>}
          <div className="mt-4 flex gap-3">
            {item.session_id && <Link className="rounded-lg border px-3 py-2 text-sm" to={`/sessions/${encodeURIComponent(item.session_id)}`}>세션으로 이동</Link>}
            {!item.handled_at && <button disabled={busy} className="rounded-lg bg-[#F5EDFC] px-3 py-2 text-sm text-[#5F0080] disabled:opacity-40" onClick={() => void perform(async () => {
              const updated = await api.markHandled(item.id); setEvents((previous) => previous.map((event) => event.id === updated.id ? updated : event));
            })}>처리 완료</button>}
          </div>
        </article>)}
      </div> : <>
        <p className="text-xs text-[#6F6F6F]">일정과 상담 기록을 확인하고 초안을 정리할 수 있어요.</p>
        <div ref={scroller} role="log" aria-label="상담사 AI 대화 메시지" className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2">
          {hasMore && <button disabled={olderBusy} onClick={() => void loadOlder()} className="mx-auto block rounded-full bg-white px-4 py-2 text-sm">{olderBusy ? '불러오는 중…' : '이전 메시지 더보기'}</button>}
          {!loading && !messages.length && <p className="py-8 text-center text-sm">오늘 일정이나 지난 상담 요약을 물어보세요.</p>}
          {messages.map((message) => <article key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl px-4 py-3 ${message.kind === 'risk_alert' ? 'border-2 border-amber-300 bg-amber-50 text-[#1F1F1F]' : message.sender === 'user' ? 'bg-[#5F0080] text-white' : 'bg-white text-[#1F1F1F]'}`}>
              <p className="mb-2 text-xs opacity-70">{message.kind === 'risk_alert' ? '위험 알림' : message.kind === 'briefing_morning' ? '아침 브리핑' : message.kind === 'briefing_evening' ? '저녁 상담 정리' : message.sender === 'user' ? '나' : 'AI 비서'}</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
              <div className="mt-3 flex flex-wrap gap-2">{message.cta.map((cta) => {
                const target = resolveCounselorCta(cta);
                return target && <button key={cta.id} disabled={busy} className="rounded-xl border bg-[#F5EDFC] px-3 py-2 text-sm text-[#5F0080] disabled:opacity-40" onClick={() => void perform(async () => { await api.runCta(message.id, cta.id); navigate(target); })}>{cta.label}</button>;
              })}</div>
              <time className="mt-2 block text-right text-xs opacity-60" dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          </article>)}
          <div ref={bottom} />
        </div>
        <form className="flex shrink-0 items-end gap-2 rounded-2xl bg-white p-3" onSubmit={(event) => {
          event.preventDefault(); if (!text.trim() || text.length > 1000) return;
          void perform(async () => {
            const result = await api.sendMessage(text); setMessages((previous) => mergeMessages(previous, [result.user_message, result.agent_message])); setText('');
            const read = await api.markRead(result.agent_message.created_at); useCounselorAgentStore.getState().setUnread(read.unread);
          });
        }}>
          <textarea aria-label="AI에게 보낼 메시지" placeholder="오늘 일정을 알려줘" maxLength={1000} rows={2} value={text} disabled={busy} onChange={(event) => setText(event.target.value)} className="min-w-0 flex-1 resize-none rounded-lg border p-2 text-sm" />
          <button type="submit" disabled={busy || !text.trim()} className="rounded-xl bg-[#5F0080] px-4 py-3 text-white disabled:opacity-40">{busy ? '처리 중…' : '보내기'}</button>
        </form>
      </>}
    </div>
    {settingsOpen && <BriefingSettingsSheet onClose={() => setSettingsOpen(false)} />}
  </AppShell>;
}
