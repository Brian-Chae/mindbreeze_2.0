import { useEffect, useRef, useState } from 'react';
import { tokenStorage } from '../../lib/api/client';
import type { WaitingRoomEntry } from '../../hooks/useWaitingRoomCount';
import { getActiveSessionLiveSocket, getSessionLiveSocket, requestWaitingRoomReminder, type WaitingRoomReadiness } from '../../lib/socket';
import { CheckinSummary } from './CheckinSummary';
import './waiting-room-readiness-panel.css';

interface WaitingRoomReadinessPanelProps { sessionId: string; entries: WaitingRoomEntry[]; isConnected?: boolean }
const steps: { key: keyof WaitingRoomReadiness; label: string }[] = [
  { key: 'surveyDone', label: '설문' }, { key: 'bandDone', label: '링크밴드' }, { key: 'deviceDone', label: '기기' },
];
export function getWaitingRoomReadiness(entry: WaitingRoomEntry): WaitingRoomReadiness {
  return entry.readiness ?? { surveyDone: Boolean(entry.checkin), bandDone: false, deviceDone: false };
}

export function WaitingRoomReadinessPanel({ sessionId, entries, isConnected }: WaitingRoomReadinessPanelProps) {
  const [connected, setConnected] = useState(() => Boolean(getActiveSessionLiveSocket()?.connected));
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const sendingRef = useRef(false);
  useEffect(() => {
    // WS-13: mount 시 아직 소켓이 없으면(getActiveSessionLiveSocket()===null) 새로 연결해
    // connect/disconnect 구독과 연결 표시를 실제 소켓 수명에 묶는다.
    const socket = getActiveSessionLiveSocket() ?? getSessionLiveSocket(tokenStorage.getAccess());
    setConnected(Boolean(socket.connected));
    const online = () => setConnected(true);
    const offline = () => setConnected(false);
    socket.on('connect', online);
    socket.on('disconnect', offline);
    return () => { socket.off('connect', online); socket.off('disconnect', offline); };
  }, [sessionId]);
  const available = isConnected ?? connected;
  const rows = entries.map(entry => ({ entry, readiness: getWaitingRoomReadiness(entry) }));
  const pending = rows.filter(row => !steps.every(step => row.readiness[step.key]));
  const complete = entries.length - pending.length;
  const percent = entries.length ? Math.round(100 * complete / entries.length) : 0;
  const remind = async () => {
    const socket = getActiveSessionLiveSocket();
    if (!socket?.connected || sendingRef.current || !pending.length) return;
    sendingRef.current = true;
    setSending(true); setError(''); setMessage('');
    try {
      const result = await requestWaitingRoomReminder(socket, sessionId, pending.map(row => row.entry.participantId));
      setMessage(`서버가 ${result.sent ?? pending.length}명에게 보낼 안내를 수락했어요.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '안내를 보내지 못했어요. 다시 시도해 주세요.');
    } finally { sendingRef.current = false; setSending(false); }
  };
  return (
    <section aria-label="참가자 준비 현황" className="waiting-readiness rounded-2xl border border-white/10 bg-[#1d1026] p-5 text-[#F7F4F0]">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">준비 현황</h3><p className="text-[#dcb5ee]">{complete} / 전체 {entries.length}명 완료</p></div>
      <div role="progressbar" aria-label="전체 참가자 준비 완료율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#dcb5ee]" style={{ width: `${percent}%` }} /></div>
      <p className="mt-2 text-xs text-[#bcaec5]">3단계 확인을 마친 참가자 · {percent}%</p>
      {entries.length === 0 && <p className="py-6 text-sm text-[#bcaec5]">아직 대기 중인 참가자가 없어요.</p>}
      <ul className="mt-4 space-y-3">{rows.map(({ entry, readiness }) => {
        const count = steps.filter(step => readiness[step.key]).length;
        return <li key={entry.participantId} className={`waiting-readiness-person rounded-xl border p-3 ${count < 3 ? 'border-[#dcb5ee]/30 bg-[#dcb5ee]/10' : 'border-white/10'}`}>
          <div className="waiting-readiness-name flex items-center justify-between gap-3"><p className="min-w-0 break-words text-sm">{count < 3 && <span aria-hidden="true" className="mr-2 text-[#F2A93B]">●</span>}{entry.nickname || '참가자'}</p><span className="waiting-readiness-count text-xs text-[#dcb5ee]">{count}/3</span></div>
          <div className="waiting-readiness-badges mt-3 grid grid-cols-3 gap-2">{steps.map(step => <span key={step.key} className={`rounded-lg border px-1 py-1.5 text-center text-xs ${readiness[step.key] ? 'border-[#dcb5ee]/30 bg-[#dcb5ee]/10 text-[#F7F4F0]' : 'border-white/10 text-[#bcaec5]'}`}><span aria-hidden="true">{readiness[step.key] ? '✓' : '○'}</span> {step.label}<span className="sr-only"> {readiness[step.key] ? '확인 완료' : '확인 전'}</span></span>)}</div>
          {entry.checkin && <div className="waiting-readiness-checkin mt-3"><CheckinSummary arousal={entry.checkin.arousal} valence={entry.checkin.valence} emotion={entry.checkin.emotion} note={entry.checkin.note} /></div>}
        </li>;
      })}</ul>
      <p className="mt-4 text-xs leading-5 text-[#bcaec5]">✓ 확인 완료 (건너뛰기·미사용 포함)　○ 확인 전</p>
      <button type="button" onClick={() => void remind()} disabled={!available || sending || !pending.length} className="mt-4 w-full rounded-xl border border-[#dcb5ee]/20 bg-[#5F0080] px-4 py-3 text-sm disabled:cursor-default disabled:opacity-40">{sending ? '안내 보내는 중…' : `미완 ${pending.length}명 리마인드`}</button>
      {!available && <p className="mt-2 text-xs text-[#bcaec5]">연결되면 준비 안내를 보낼 수 있어요.</p>}
      {message && <p role="status" className="mt-2 text-xs text-[#dcb5ee]">{message}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </section>
  );
}
