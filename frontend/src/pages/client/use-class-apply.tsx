import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listChatRooms, sendChatMessage } from '../../lib/api/chat';
import { ApplySheet, type ApplyOption } from '../../components/class/flow/shell/ApplySheet';
import '../../components/class/flow/shell/shell-kit.css';

/** 회원 클래스 신청(상담사에게 신청 메시지 전송) 시트와 토스트를 묶어 제공한다. */
export function useClassApply(): { openApply: () => void; overlay: ReactNode } {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ApplyOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const openedFromHome = useRef(false);

  const loadRooms = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const res = await listChatRooms();
      const next = res.rooms.filter((r) => r.room_type === 'direct').map((r) => ({ id: r.id, name: r.peer_name || r.name || '채팅방' }));
      setOptions(next);
      setSelectedId((prev) => (prev && next.some((o) => o.id === prev) ? prev : next[0]?.id ?? null));
    } catch (e: unknown) {
      setOptions([]);
      setSelectedId(null);
      setLoadError(e instanceof Error ? e.message : '채팅방 목록을 불러오지 못했어요');
    }
  }, []);

  const openApply = useCallback((): void => {
    setOpen(true);
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    const state = location.state as { openApply?: boolean } | null;
    if (!state?.openApply || openedFromHome.current) return;
    openedFromHome.current = true;
    openApply();
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, openApply]);

  const showToast = (message: string): void => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const send = async (): Promise<void> => {
    if (!selectedId) return;
    setSending(true);
    try {
      await sendChatMessage(selectedId, { content: '클래스 신청합니다', type: 'system', event_type: 'session_request' });
      setOpen(false);
      showToast('클래스 신청을 보냈어요');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '클래스 신청을 보내지 못했어요');
    } finally {
      setSending(false);
    }
  };

  const overlay = <div className="sh-scope">
    {toast && <div role="status" className="fixed top-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#1F1F1F] px-5 py-2.5 text-sm text-white shadow-lg">{toast}</div>}
    <ApplySheet open={open} options={options} selectedId={selectedId} onSelect={setSelectedId} onSend={() => void send()} onClose={() => setOpen(false)} sending={sending} loadError={loadError} onRetry={() => void loadRooms()} />
  </div>;
  return { openApply, overlay };
}
