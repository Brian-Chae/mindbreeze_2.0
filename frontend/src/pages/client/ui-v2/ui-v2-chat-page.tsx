// SDD-318 — 채팅(D안): 대화 목록 + 대화방 + 루시(AI). 목록 조회·정렬·방 메뉴·전송/읽음/실시간 동작은 기존 컴포넌트(ChatRoom 등)를 그대로 쓰고
// 이 파일은 쉘·마크업·스킨만 바꾼다. 방 진입(/app/chat/:roomId)에서는 하단 내비를 숨기고 뒤로가기 헤더를 쓴다.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import { ChatRoom } from '../../../components/chat/ChatRoom';
import { LUCY_NOTICE } from '../../../components/chat/ChatMobileHeader';
import { ChatSortToggle } from '../../../components/chat/ChatSortToggle';
import { RoomActionsMenu } from '../../../components/chat/RoomActionsMenu';
import { RoomSettingsModal } from '../../../components/chat/RoomSettingsModal';
import { listChatRooms, type ChatRoom as ChatRoomDto } from '../../../lib/api/chat';
import { chatRoomDisplayName, formatChatTime, lastMessagePreview, sortRooms } from '../../../lib/chat-sort';
import { isAiEnabled } from '../../../lib/feature-flags';
import { useChatSortPreference } from '../../../hooks/useChatSortPreference';
import { useIsDesktop } from '../../../hooks/use-is-desktop';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { useAgentStore } from '../../../stores/agent-store';
import AiAgentPage from '../ai-agent-page';
import { LUCY_ROOM_ID } from '../ClientChatPage';

function getInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return '클래스 채팅';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '클래스 채팅';
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${day}) ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function roomDisplaySub(room: ChatRoomDto): string {
  if (room.room_type === 'direct') return '1:1 대화';
  if (room.room_type === 'group') return '그룹 대화';
  return formatSessionDate(room.session_scheduled_at);
}

export function UiV2ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetMessageId = searchParams.get('message') || undefined;
  const showRecentMessages = () => {
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.delete('message'); return next; }, { replace: true });
  };
  const user = useAuthStore((s) => s.user);
  const rooms = useChatStore((s) => s.rooms);
  const setRooms = useChatStore((s) => s.setRooms);
  const sortPreference = useChatSortPreference();
  const sortedRooms = useMemo(() => sortRooms(rooms, sortPreference.unreadFirst), [rooms, sortPreference.unreadFirst]);
  const [settingsRoom, setSettingsRoom] = useState<ChatRoomDto | null>(null);
  const [status, setStatus] = useState('');
  const hasCounselors = (user?.counselors?.length ?? 0) > 0;
  const agentUnread = useAgentStore((state) => state.unread);
  const paramRoomId = useMemo(() => {
    const match = location.pathname.match(/^\/app\/chat\/([^/]+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(''), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    let requestId = 0;
    let abortRetries = 0;
    const refreshRooms = () => {
      const currentRequest = ++requestId;
      const snapshot = useChatStore.getState().rooms;
      void listChatRooms()
        .then((res) => {
          if (cancelled || currentRequest !== requestId) return;
          setError(null);
          setRooms(res.rooms, snapshot);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled || currentRequest !== requestId) return;
          // 새로고침 직후 계정 복원과 첫 조회가 겹치면 AbortError 가 난다 — 오류로 노출하지 않고 다시 조회한다.
          if (err instanceof DOMException && err.name === 'AbortError' && abortRetries < 2) {
            abortRetries += 1;
            window.setTimeout(() => { if (!cancelled) refreshRooms(); }, 150);
            return;
          }
          setError(err instanceof Error ? err.message : '채팅방 목록을 불러올 수 없습니다');
          setLoading(false);
        });
    };
    refreshRooms();
    window.addEventListener('focus', refreshRooms);
    return () => { cancelled = true; window.removeEventListener('focus', refreshRooms); };
  }, [setRooms]);

  // AI 비공개일 때는 루시 채널을 만들지 않고 직접 URL 은 일반 채팅으로 돌려보낸다.
  const aiEnabled = isAiEnabled();
  const isLucy = aiEnabled && paramRoomId === LUCY_ROOM_ID;
  useEffect(() => {
    if (!aiEnabled && paramRoomId === LUCY_ROOM_ID) navigate('/app/chat', { replace: true });
  }, [aiEnabled, paramRoomId, navigate]);

  const selectedRoom: ChatRoomDto | null = useMemo(() => {
    if (!paramRoomId || paramRoomId === LUCY_ROOM_ID) return null;
    return rooms.find((r) => r.id === paramRoomId) ?? rooms.find((r) => r.session_id === paramRoomId) ?? null;
  }, [rooms, paramRoomId]);

  const headerTitle = isLucy ? '루시 (AI)' : selectedRoom ? chatRoomDisplayName(selectedRoom) : '대화';
  const headerSub = isLucy ? LUCY_NOTICE : selectedRoom ? roomDisplaySub(selectedRoom) : undefined;
  const roomMenu = selectedRoom && !isLucy
    ? <RoomActionsMenu room={selectedRoom} onSettings={() => setSettingsRoom(selectedRoom)} onLeave={() => navigate('/app/chat')} />
    : null;
  const inRoom = !!paramRoomId;
  // 모바일 방 화면: 큰 제목 대신 뒤로가기 헤더. 데스크톱: 목록 + 방 2단.
  const mobileRoom = inRoom && !isDesktop;

  const list = (
    <section className={`u2-chat-list${inRoom && !isDesktop ? ' u2-chat-list--hidden' : ''}`} aria-label="대화 목록">
      <div className="u2-legacy"><ChatSortToggle {...sortPreference} /></div>
      {aiEnabled && (
        <button type="button" onClick={() => navigate(`/app/chat/${LUCY_ROOM_ID}`)} aria-current={isLucy ? 'page' : undefined} className="u2-chatrow u2-chatrow--lucy" data-active={isLucy || undefined}>
          <span className="u2-avatar u2-avatar--solid" aria-hidden="true">루시</span>
          <span className="u2-body">
            <strong>루시 (AI)</strong>
            <span>예약 안내 · 리포트 이야기 · 안부</span>
          </span>
          {agentUnread > 0 && <span className="u2-badge" aria-label={`읽지 않음 ${agentUnread}건`}>{agentUnread > 99 ? '99+' : agentUnread}</span>}
        </button>
      )}
      {loading ? (
        <p className="u2-empty" role="status">불러오는 중...</p>
      ) : error ? (
        <p className="u2-empty u2-error" role="alert">{error}</p>
      ) : rooms.length === 0 ? (
        !hasCounselors
          ? <p className="u2-empty">코치와 연결하면 코치와의 1:1 채팅이 여기에 표시돼요.</p>
          : <p className="u2-empty">아직 대화가 없어요</p>
      ) : (
        <ul className="u2-chatlist">
          {sortedRooms.map((room) => {
            const isActive = room.id === paramRoomId;
            const when = room.last_message_at ?? room.last_message?.created_at ?? room.created_at;
            return (
              <li key={room.id} className="u2-chatitem" data-active={isActive || undefined}>
                <button type="button" onClick={() => navigate(`/app/chat/${room.id}`)} className="u2-chatrow" data-active={isActive || undefined}>
                  <span className="u2-avatar" aria-hidden="true">{room.room_type === 'direct' ? getInitials(room.peer_name) : '#'}</span>
                  <span className="u2-body">
                    <span className="u2-chatrow-top">
                      <strong>{chatRoomDisplayName(room)}</strong>
                      {when && <small>{formatChatTime(when)}</small>}
                    </span>
                    <span>{lastMessagePreview(room, roomDisplaySub(room))}</span>
                  </span>
                  {(room.unread_count ?? 0) > 0 && <span className="u2-badge" aria-label={`읽지 않음 ${room.unread_count}건`}>{room.unread_count > 99 ? '99+' : room.unread_count}</span>}
                </button>
                <div className="u2-legacy"><RoomActionsMenu room={room} onSettings={() => setSettingsRoom(room)} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const pane = (
    <section className={`u2-chat-pane${inRoom ? '' : ' u2-chat-pane--empty'}`} aria-label="대화방">
      {isLucy ? (
        <>
          {isDesktop && <div className="u2-chat-roomhead"><strong>{headerTitle}</strong><small>{headerSub}</small></div>}
          {!isDesktop && headerSub && <p className="u2-chat-sub">{headerSub}</p>}
          <div className="u2-legacy u2-chat-body"><AiAgentPage key={user?.id} embedded /></div>
        </>
      ) : selectedRoom ? (
        <>
          {isDesktop && <div className="u2-chat-roomhead"><span><strong>{headerTitle}</strong><small>{headerSub}</small></span><span className="u2-legacy">{roomMenu}</span></div>}
          {!isDesktop && headerSub && <p className="u2-chat-sub">{headerSub}</p>}
          <div className="u2-legacy u2-chat-body">
            <ChatRoom key={selectedRoom.id} targetMessageId={targetMessageId} onShowRecent={showRecentMessages} roomId={selectedRoom.id} peerName={selectedRoom.peer_name ?? undefined} />
          </div>
        </>
      ) : paramRoomId && !loading ? (
        <p className="u2-empty">채팅방을 찾을 수 없습니다.</p>
      ) : (
        <p className="u2-empty">왼쪽에서 대화를 선택하세요.</p>
      )}
    </section>
  );

  return (
    <UiV2ClientShell
      title={headerTitle}
      back={mobileRoom ? { to: '/app/chat', label: '대화 목록으로' } : undefined}
      heading={mobileRoom ? false : true}
      hideBottomNav={mobileRoom}
      fill={inRoom || isDesktop}
      wide
      trailing={mobileRoom && roomMenu ? <span className="u2-legacy u2-trailing">{roomMenu}</span> : undefined}
    >
      <div className={`u2-chat${inRoom ? ' u2-chat--room' : ''}`}>
        {list}
        {(inRoom || isDesktop) && pane}
      </div>
      {status && <p role="status" className="u2-toast">{status}</p>}
      {settingsRoom && <RoomSettingsModal key={settingsRoom.id} room={settingsRoom} onClose={() => setSettingsRoom(null)} onSaved={setStatus} />}
    </UiV2ClientShell>
  );
}
