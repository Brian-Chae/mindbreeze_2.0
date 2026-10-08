import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { useNavigate } from 'react-router-dom';
import ClientShell from '../../components/client/ClientShell';
import CtaCard from '../../components/client/agent/cta-card';
import * as agentApi from '../../lib/api/agent';
import type { AgentConsent, AgentCta, AgentMessage } from '../../lib/api/agent';
import { ApiError } from '../../lib/api/client';
import { getSession } from '../../lib/api/session';
import { canAccessAgent, isCtaDisabled, mergeAgentMessages, resolveCta } from '../../lib/agent/actions';
import { useAgentStore } from '../../stores/agent-store';

export default function AiAgentPage() {
  const navigate = useNavigate();
  const [consent, setConsent] = useState<AgentConsent | null>(null);
  const [declined, setDeclined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [changeRequest, setChangeRequest] = useState<{ messageId: string; cta: AgentCta } | null>(null);
  const [reason, setReason] = useState('');
  const [reload, setReload] = useState(0);
  const historyLoaded = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const access = canAccessAgent(consent, declined);
  const changeDialogRef = useDialogA11y(Boolean(changeRequest && access), () => { if (!lock.current) setChangeRequest(null); });
  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.');
    if (err instanceof ApiError && err.status === 403) {
      setConsent(null);
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    agentApi.getConsent().then((value) => { if (!cancelled) setConsent(value); })
      .catch((err: unknown) => { if (!cancelled) fail(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload, fail]);

  useEffect(() => {
    if (!access) return;
    let cancelled = false;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await agentApi.listMessages();
        if (cancelled) return;
        setMessages((previous) => mergeAgentMessages(previous, result.items));
        if (!historyLoaded.current) { setHasMore(result.has_more); historyLoaded.current = true; }
        const latest = result.items[0]?.created_at;
        if (latest) {
          const read = await agentApi.markRead(latest);
          if (!cancelled) useAgentStore.getState().setUnread(read.unread);
        }
      } catch (err) { if (!cancelled) fail(err); }
      finally { fetching = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [access, reload, fail]);

  const latestId = messages.at(-1)?.id;
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }); }, [latestId]);

  const loadOlder = async () => {
    if (olderBusy || !access) return;
    setOlderBusy(true);
    const height = scroller.current?.scrollHeight ?? 0;
    const top = scroller.current?.scrollTop ?? 0;
    try {
      const result = await agentApi.listMessages(messages[0]?.created_at);
      setMessages((previous) => mergeAgentMessages(previous, result.items));
      setHasMore(result.has_more);
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop = top + scroller.current.scrollHeight - height;
      });
    } catch (err) { fail(err); } finally { setOlderBusy(false); }
  };

  const perform = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try { await work(); } catch (err) { fail(err); }
    finally { lock.current = false; setBusy(false); }
  };

  const submitCta = async (messageId: string, cta: AgentCta, body = {}) => {
    const result = await agentApi.runCta(messageId, cta.id, body);
    setMessages((previous) => mergeAgentMessages(previous.map((message) => message.id === messageId ? {
      ...message,
      cta: message.cta.map((item) => item.id === cta.id ? result.cta :
        cta.action === 'feedback_choice' && item.action === 'feedback_choice' ? { ...item, done: true } : item),
    } : message), result.agent_message ? [result.agent_message] : []));
    if (result.agent_message) {
      try {
        const read = await agentApi.markRead(result.agent_message.created_at);
        useAgentStore.getState().setUnread(read.unread);
      } catch (err) { fail(err); }
    }
  };

  const handleCta = (message: AgentMessage, cta: AgentCta) => {
    if (!access || lock.current || isCtaDisabled(cta, message.cta)) return;
    const effect = resolveCta(cta);
    if (!effect) return;
    if (effect.type === 'reason') { setReason(''); setChangeRequest({ messageId: message.id, cta }); return; }
    // 팝업 차단을 피하기 위해 사용자의 클릭 이벤트 안에서 새 창을 연다.
    if (effect.type === 'map') window.open(effect.url, '_blank', 'noopener,noreferrer');
    void perform(async () => {
      if (effect.type === 'submit') { await submitCta(message.id, cta); return; }
      if (effect.type === 'join') {
        const session = await getSession(effect.sessionId);
        navigate(session.access_code && ['open', 'in_progress'].includes(session.status)
          ? `/join?code=${encodeURIComponent(session.access_code)}`
          : `/app/sessions/${encodeURIComponent(effect.sessionId)}`);
      } else if (effect.type === 'navigate') {
        if (effect.url.startsWith('/')) navigate(effect.url);
        else window.location.assign(effect.url);
      } else if (effect.type === 'phone') window.location.assign(effect.url);
      await agentApi.runCta(message.id, cta.id);
    });
  };

  return <ClientShell title="AI 대화" sub="AI ASSISTANT" noScroll contentPad="px-4 py-3 md:px-8 md:py-6">
    <div className="mx-auto flex h-full min-h-0 max-w-2xl flex-col gap-3 font-sans">
      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}
        <button className="ml-2 underline" onClick={() => setReload((value) => value + 1)}>다시 시도</button>
      </div>}
      {loading ? <p role="status">동의 상태를 확인하고 있어요…</p> : !access ? (
        <section aria-labelledby="agent-consent-title" className="my-auto rounded-3xl bg-white p-6 shadow-sm">
          <span className="inline-block rounded-full bg-[#01f0c8] px-3 py-1 text-sm">마음 곁의 AI 비서</span>
          <h2 id="agent-consent-title" className="mt-4 text-xl font-bold">AI 대화를 시작하기 전에</h2>
          <ul className="my-5 space-y-3 text-sm leading-relaxed">
            <li>AI가 예약 안내와 리포트에 관해 먼저 연락합니다.</li>
            <li>대화는 요약으로 상담사에게 전달됩니다.</li>
            <li><strong>피드백은 상담사에게 그대로 전달됩니다.</strong></li>
            <li>AI 대화는 상담을 대신하지 않습니다.</li>
          </ul>
          {declined && <p role="status" className="mb-3 text-sm">동의하지 않으면 AI 대화를 이용할 수 없습니다.</p>}
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => { setDeclined(true); setMessages([]); }} className="rounded-xl border px-4 py-3">동의하지 않음</button>
            <button disabled={busy || !consent} onClick={() => void perform(async () => { const value = await agentApi.agree(); setConsent(value); setDeclined(false); })}
              className="flex-1 rounded-xl bg-[#5F0080] px-4 py-3 font-semibold text-white disabled:opacity-40">동의하고 시작하기</button>
          </div>
        </section>
      ) : <>
        <p className="text-xs text-[#6F6F6F]">AI 대화는 상담을 대신하지 않아요. 피드백은 상담사에게 그대로 전달돼요.</p>
        <div ref={scroller} role="log" aria-label="AI 대화 메시지" className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2">
          {hasMore && <button disabled={olderBusy} onClick={() => void loadOlder()} className="mx-auto block rounded-full bg-white px-4 py-2 text-sm text-[#5F0080]">{olderBusy ? '불러오는 중…' : '이전 메시지 더보기'}</button>}
          {!messages.length && <p className="py-8 text-center text-sm text-[#6F6F6F]">궁금한 점이나 나누고 싶은 이야기를 남겨 주세요.</p>}
          {messages.map((message) => <article key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl px-4 py-3 ${message.sender === 'user' ? 'bg-[#5F0080] text-white' : 'bg-white text-[#1F1F1F]'}`}>
              <p className="mb-1 text-xs opacity-70">{message.sender === 'user' ? '나' : message.sender === 'system' ? '안내' : 'AI 비서'}</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
              <CtaCard ctas={message.cta} busy={busy} onAction={(cta) => handleCta(message, cta)} />
              <time className="mt-2 block text-right text-xs opacity-60" dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          </article>)}
          <div ref={bottom} />
        </div>
        <form className="flex shrink-0 items-end gap-2 rounded-2xl bg-white p-3" onSubmit={(event) => {
          event.preventDefault();
          if (!access || !text.trim() || text.length > 1000) return;
          void perform(async () => {
            const result = await agentApi.sendMessage(text);
            setMessages((previous) => mergeAgentMessages(previous, [result.user_message, result.agent_message]));
            setText('');
            const read = await agentApi.markRead(result.agent_message.created_at);
            useAgentStore.getState().setUnread(read.unread);
          });
        }}>
          <textarea aria-label="AI에게 보낼 메시지" placeholder="이야기를 남겨 주세요" maxLength={1000} rows={2} value={text} disabled={busy}
            onChange={(event) => setText(event.target.value)} className="min-w-0 flex-1 resize-none rounded-lg p-2 text-sm focus:outline-[#5F0080]" />
          <button disabled={busy || !text.trim()} className="rounded-xl bg-[#5F0080] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? '처리 중…' : '전송'}</button>
        </form>
      </>}
      {changeRequest && access && <div ref={changeDialogRef} tabIndex={-1} className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 md:items-center">
        <form role="dialog" aria-modal="true" aria-labelledby="change-request-title" className="w-full max-w-md rounded-3xl bg-white p-6" onSubmit={(event) => {
          event.preventDefault();
          if (!reason.trim() || reason.length > 500) return;
          void perform(async () => { await submitCta(changeRequest.messageId, changeRequest.cta, { reason }); setChangeRequest(null); });
        }}>
          <h2 id="change-request-title" className="text-lg font-bold">일정 변경 문의</h2>
          <label className="mt-4 block text-sm" htmlFor="agent-change-reason">변경 사유 (필수)</label>
          <textarea autoFocus id="agent-change-reason" required maxLength={500} rows={4} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} className="mt-2 w-full rounded-xl border p-3 text-sm" />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => setChangeRequest(null)} className="rounded-xl border px-4 py-2">취소</button>
            <button disabled={busy || !reason.trim()} className="rounded-xl bg-[#5F0080] px-4 py-2 text-white disabled:opacity-40">문의 보내기</button>
          </div>
        </form>
      </div>}
    </div>
  </ClientShell>;
}
