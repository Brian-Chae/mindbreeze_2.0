// SDD-320 후속 — 코치 채팅(D안): 대화 목록 + 대화방 + 루시(AI). 목록 조회·정렬·방 메뉴·초대·설정·전송/읽음/실시간은
// 기존 ChatPage 와 같은 컴포넌트/스토어/API 를 그대로 쓰고, 이 파일은 마크업·스킨만 D안으로 바꾼다. 쉘(사이드바·알림·하단 메뉴)은 AppShell 재사용.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import AppShell from '../../../components/layout/AppShell';
import { ChatRoom } from '../../../components/chat/ChatRoom';
import { CreateRoomModal } from '../../../components/chat/CreateRoomModal';
import { ChatSortToggle } from '../../../components/chat/ChatSortToggle';
import { RoomActionsMenu } from '../../../components/chat/RoomActionsMenu';
import { RoomSettingsModal } from '../../../components/chat/RoomSettingsModal';
import { InviteMemberModal } from '../../../components/chat/InviteMemberModal';
import { LUCY_COUNSELOR_NOTICE } from '../../../components/chat/ChatMobileHeader';
import { canInviteToRoom } from '../../../lib/api/chat-invite';
import { listChatRooms, type ChatRoom as ChatRoomDto } from '../../../lib/api/chat';
import { chatRoomDisplayName, formatChatTime, lastMessagePreview, sortRooms } from '../../../lib/chat-sort';
import { isAiEnabled } from '../../../lib/feature-flags';
import { useChatSortPreference } from '../../../hooks/useChatSortPreference';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { useCounselorAgentStore } from '../../../stores/agent-counselor-store';
import CounselorAgentPage from '../../agent/counselor-agent-page';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-screens.css';

/** AI 채널(루시) 고정 방 ID — 경로 /chat/lucy */
const LUCY_ROOM_ID = 'lucy';

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return '세션 채팅';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '세션 채팅';
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${day}) ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function roomSub(room: ChatRoomDto): string {
  if (room.room_type === 'direct') return '1:1 대화';
  if (room.room_type === 'group') return '그룹 대화';
  return formatSessionDate(room.session_scheduled_at);
}
function roomLabel(room: ChatRoomDto): string {
  const count = room.participant_count ?? 0;
  return `${chatRoomDisplayName(room)}${count > 0 ? ` (${count}명)` : ''}`;
}

export function UiV2CoachChatPage() {
  const { roomId: paramRoomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetMessageId = searchParams.get('message') || undefined;
  const showRecentMessages = () => {
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.delete('message'); return next; }, { replace: true });
  };
  const rooms = useChatStore((s) => s.rooms);
  const setRooms = useChatStore((s) => s.setRooms);
  const agentUnread = useCounselorAgentStore((state) => state.unread + state.openRisk);
  // SDD-220: AI 비공개일 때는 루시 채널·embedded agent 를 만들지 않고, 직접 URL 은 일반 채팅으로 돌려보낸다.
  const aiEnabled = isAiEnabled();
  const isLucy = aiEnabled && paramRoomId === LUCY_ROOM_ID;
  const sortPreference = useChatSortPreference();
  const sortedRooms = useMemo(() => sortRooms(rooms, sortPreference.unreadFirst), [rooms, sortPreference.unreadFirst]);
  const [settingsRoom, setSettingsRoom] = useState<ChatRoomDto | null>(null);
  const [inviteRoom, setInviteRoom] = useState<ChatRoomDto | null>(null);
  const [returnToSettings, setReturnToSettings] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { setInviteRoom(null); setSettingsRoom(null); }, [paramRoomId]);
  useEffect(() => {
    if (!aiEnabled && paramRoomId === LUCY_ROOM_ID) navigate('/chat', { replace: true });
  }, [aiEnabled, paramRoomId, navigate]);
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(''), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    let requestId = 0;
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
          setError(err instanceof Error ? err.message : '로딩 실패');
          setLoading(false);
        });
    };
    refreshRooms();
    window.addEventListener('focus', refreshRooms);
    return () => { cancelled = true; window.removeEventListener('focus', refreshRooms); };
  }, [setRooms]);

  const selectedRoom: ChatRoomDto | null = useMemo(() => {
    if (!paramRoomId || paramRoomId === LUCY_ROOM_ID) return null;
    return rooms.find((r) => r.id === paramRoomId) ?? rooms.find((r) => r.session_id === paramRoomId) ?? null;
  }, [rooms, paramRoomId]);

  const openInvite = (room: ChatRoomDto, fromSettings = false): void => {
    if (!canInviteToRoom(room, useAuthStore.getState().user)) return;
    setReturnToSettings(fromSettings);
    setSettingsRoom(null);
    setInviteRoom(room);
  };

  const headerTitle = isLucy ? '루시 (AI)' : selectedRoom ? roomLabel(selectedRoom) : '채팅';
  const headerSub = isLucy ? LUCY_COUNSELOR_NOTICE : selectedRoom ? roomSub(selectedRoom) : undefined;
  const inRoom = !!paramRoomId;
  const roomMenu = selectedRoom && !isLucy
    ? <RoomActionsMenu room={selectedRoom} onSettings={() => setSettingsRoom(selectedRoom)} onInvite={() => openInvite(selectedRoom)} onLeave={() => navigate('/chat')} />
    : null;

  // 11/9 대표 지시: '새 채팅방'은 상단 오른쪽(알림 버튼 옆)으로. 방 안에서는 방 메뉴를 그대로 쓴다.
  const newRoomButton = (
    <button type="button" className="u2-primary u2c-new" onClick={() => setShowCreate(true)}>
      <Plus size={18} aria-hidden="true" /> 새 채팅방
    </button>
  );

  const list = (
    <section className={`u2-chat-list${inRoom ? ' u2c-list--room' : ''}`} aria-label="대화 목록">
      <div className="u2-legacy"><ChatSortToggle {...sortPreference} /></div>
      {aiEnabled && (
        <button type="button" onClick={() => navigate(`/chat/${LUCY_ROOM_ID}`)} aria-current={isLucy ? 'page' : undefined} className="u2-chatrow u2-chatrow--lucy" data-active={isLucy || undefined}>
          <span className="u2-avatar u2-avatar--solid" aria-hidden="true">루시</span>
          <span className="u2-body">
            <strong>루시 (AI)</strong>
            <span>아침 브리핑 · 저녁 정리 · 내담자 피드백</span>
          </span>
          {agentUnread > 0 && <span className="u2-badge" aria-label={`읽지 않음 ${agentUnread}건`}>{agentUnread > 99 ? '99+' : agentUnread}</span>}
        </button>
      )}
      {loading ? (
        <p className="u2-empty" role="status">불러오는 중…</p>
      ) : error ? (
        <p className="u2-empty u2-error" role="alert">{error}</p>
      ) : rooms.length === 0 ? (
        <p className="u2-empty">아직 채팅방이 없어요.<br />위의 <strong>새 채팅방</strong> 버튼으로 시작하세요.</p>
      ) : (
        <ul className="u2-chatlist">
          {sortedRooms.map((room) => {
            const isActive = room.id === paramRoomId;
            const when = room.last_message_at ?? room.last_message?.created_at ?? room.created_at;
            return (
              <li key={room.id} className="u2-chatitem" data-active={isActive || undefined}>
                <button type="button" onClick={() => navigate(`/chat/${room.id}`)} className="u2-chatrow" data-active={isActive || undefined}>
                  <span className="u2-avatar" aria-hidden="true">{room.room_type === 'direct' ? getInitials(room.peer_name) : '#'}</span>
                  <span className="u2-body">
                    <span className="u2-chatrow-top">
                      <strong>{roomLabel(room)}</strong>
                      {when && <small>{formatChatTime(when)}</small>}
                    </span>
                    <span>{lastMessagePreview(room, roomSub(room))}</span>
                  </span>
                  {(room.unread_count ?? 0) > 0 && <span className="u2-badge" aria-label={`읽지 않음 ${room.unread_count}건`}>{room.unread_count > 99 ? '99+' : room.unread_count}</span>}
                </button>
                <div className="u2-legacy"><RoomActionsMenu room={room} onSettings={() => setSettingsRoom(room)} onInvite={() => openInvite(room)} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const roomBar = (
    <div className="u2c-roombar">
      <button type="button" className="u2-icon-btn" aria-label="대화 목록으로" onClick={() => navigate('/chat')}><ArrowLeft size={22} aria-hidden="true" /></button>
      <span className="u2c-roombar-title"><strong>{headerTitle}</strong><small>{headerSub}</small></span>
      {roomMenu && <span className="u2-legacy u2-trailing">{roomMenu}</span>}
    </div>
  );

  const pane = (
    <section className={`u2-chat-pane${inRoom ? '' : ' u2-chat-pane--empty u2c-pane--idle'}`} aria-label="대화방">
      {isLucy ? (
        <>
          {roomBar}
          <div className="u2-legacy u2-chat-body"><CounselorAgentPage embedded /></div>
        </>
      ) : selectedRoom ? (
        <>
          {roomBar}
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
    <AppShell title={headerTitle} sub={headerSub} rightSlot={inRoom ? roomMenu ?? undefined : newRoomButton} contentPad="" noScroll hideBottomTab={inRoom} noBottomPad={inRoom} hideMobileTitle={inRoom}>
      <div className={`ui-v2 u2c h-full${inRoom ? ' u2c--room' : ''}`}>
        <div className={`u2-chat${inRoom ? ' u2-chat--room' : ''}`}>
          {list}
          {pane}
        </div>
        {status && <p role="status" className="u2-toast">{status}</p>}
      </div>
      {settingsRoom && <RoomSettingsModal key={settingsRoom.id} room={settingsRoom} onClose={() => setSettingsRoom(null)} onSaved={setStatus} onInvite={(room) => openInvite(room, true)} />}
      {inviteRoom && <InviteMemberModal key={inviteRoom.id} room={inviteRoom} onClose={() => {
        if (returnToSettings) setSettingsRoom(useChatStore.getState().rooms.find((room) => room.id === inviteRoom.id) ?? inviteRoom);
        setInviteRoom(null);
      }} onSuccess={(result, mode) => {
        setInviteRoom(null);
        if (mode === 'fork') {
          setStatus('새 그룹 채팅방을 만들었습니다. 기존 방은 그대로 유지됩니다.');
          navigate(`/chat/${result.id}`);
        } else {
          setStatus('회원을 초대했습니다.');
          if (returnToSettings) setSettingsRoom(result);
        }
      }} />}
      <CreateRoomModal open={showCreate} onClose={() => setShowCreate(false)} />
    </AppShell>
  );
}
