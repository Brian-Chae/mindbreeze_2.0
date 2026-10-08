import { AgentBubble, AgentInputBar } from '../../components/chat/agent-bubble';
import RiskSignals from './risk-signals';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import * as api from '../../lib/api/agent-counselor';
import type { CounselorMessage, RelayEvent } from '../../lib/api/agent-counselor';
import { useCounselorAgentStore } from '../../stores/agent-counselor-store';
import BriefingSettingsSheet from './briefing-settings-sheet';
import { feedbackLabel, mergeMessages, resolveCounselorCta, sortRelayEvents } from './counselor-agent-utils';

export default function CounselorAgentPage({ embedded = false }: { embedded?: boolean } = {}) {
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
  const settingsButton = <button onClick={() => setSettingsOpen(true)} className="rounded-xl border bg-white px-4 py-2 text-sm">브리핑 설정</button>;
  const content = <>
    <div className={`flex h-full min-h-0 flex-col ${embedded ? 'bg-white' : 'mx-auto max-w-3xl gap-3'}`}>
      <div className={`flex flex-wrap items-center gap-2 ${embedded ? 'shrink-0 border-b border-[#EFEFEF] bg-white px-4 py-2' : ''}`} aria-label="루시 (AI) 채널 메뉴">
        <button aria-pressed={!relayTab && !riskTab} onClick={() => setParams({})} className={`rounded-xl px-4 py-2 ${!relayTab && !riskTab ? 'bg-[#5F0080] text-white' : 'bg-white'}`}>대화·브리핑</button>
        <button aria-pressed={relayTab} onClick={() => setParams({ tab: 'relay' })} className={`rounded-xl px-4 py-2 ${relayTab ? 'bg-[#5F0080] text-white' : 'bg-white'}`}>내담자 피드백·일정 변경 문의</button>
        <button aria-pressed={riskTab} onClick={() => setParams({ tab: 'risk' })} className={`rounded-xl px-4 py-2 ${riskTab ? 'bg-[#5F0080] text-white' : 'bg-white'}`}>위험 신호{openRisk > 0 ? ` · 미처리 ${openRisk}` : ''}</button>
        {embedded && <span className="ml-auto">{settingsButton}</span>}
      </div>
      {error && <div role="alert" className="m-3 shrink-0 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}<button onClick={() => { setError(''); setReload((value) => value + 1); }} className="ml-2 underline">다시 시도</button></div>}
      {loading && <p role="status" className="px-4 py-2 text-sm text-[#6F6F6F]">불러오는 중…</p>}
      {riskTab ? <div className="min-h-0 flex-1 overflow-y-auto p-4"><RiskSignals /></div> : relayTab ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
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
        <p className="shrink-0 px-4 py-1.5 text-xs text-[#6F6F6F] bg-white">일정과 상담 기록을 확인하고 초안을 정리할 수 있어요.</p>
        <div ref={scroller} role="log" aria-label="루시 (AI) 대화 메시지" className="flex-1 min-h-0 overflow-y-auto px-4 py-2 bg-white">
          {hasMore && <button disabled={olderBusy} onClick={() => void loadOlder()} className="mx-auto my-2 block rounded-full bg-[#F5EDFC] px-4 py-2 text-sm text-[#5F0080]">{olderBusy ? '불러오는 중…' : '이전 메시지 더보기'}</button>}
          {!loading && !messages.length && <div className="text-center text-gray-500 py-4">오늘 일정이나 지난 상담 요약을 물어보세요.</div>}
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const label = message.kind === 'risk_alert' ? '위험 알림' : message.kind === 'briefing_morning' ? '아침 브리핑' : message.kind === 'briefing_evening' ? '저녁 상담 정리' : undefined;
            return <AgentBubble key={message.id} isMine={message.sender === 'user'} showSender={!previous || previous.sender === 'user'}
              label={label} emphasis={message.kind === 'risk_alert'} content={message.content} createdAt={message.created_at}
              actions={message.cta.length ? <div className="mt-3 flex flex-wrap gap-2">{message.cta.map((cta) => {
                const target = resolveCounselorCta(cta);
                return target && <button key={cta.id} disabled={busy} className="rounded-xl border border-[#5F0080]/20 bg-white px-3 py-2 text-sm text-[#5F0080] disabled:opacity-40" onClick={() => void perform(async () => { await api.runCta(message.id, cta.id); navigate(target); })}>{cta.label}</button>;
              })}</div> : undefined} />;
          })}
          <div ref={bottom} />
        </div>
        <AgentInputBar ariaLabel="루시에게 보낼 메시지" placeholder="오늘 일정을 알려줘" value={text} onChange={setText} disabled={busy} busy={busy}
          onSubmit={() => {
            if (!text.trim() || text.length > 1000) return;
            void perform(async () => {
              const result = await api.sendMessage(text); setMessages((previous) => mergeMessages(previous, [result.user_message, result.agent_message])); setText('');
              const read = await api.markRead(result.agent_message.created_at); useCounselorAgentStore.getState().setUnread(read.unread);
            });
          }} />
      </>}
    </div>
    {settingsOpen && <BriefingSettingsSheet onClose={() => setSettingsOpen(false)} />}
  </>;
  if (embedded) return content;
  return <AppShell title="루시 (AI)" sub="AI ASSISTANT" noScroll rightSlot={settingsButton}>{content}</AppShell>;
}
