// 채팅방 — iOS 모바일 대응 재구현 + WebSocket 실시간
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listChatMessages, listChatMessagesAround, sendChatMessage, markRoomRead, markMessagesRead, type ChatMessage } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { getChatSocket } from '../../lib/socket';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';
import type { Socket } from 'socket.io-client';

// ---- 날짜 포맷 유틸 (KST 기준) ----

const DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const KST_OPTS = { timeZone: 'Asia/Seoul' } as const;

/** ISO 문자열 → KST 기준 "2025년 5월 27일 화요일 오전" */
function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const y = d.toLocaleString('en-US', { ...KST_OPTS, year: 'numeric' });
  const M = d.toLocaleString('en-US', { ...KST_OPTS, month: 'numeric' });
  const dd = d.toLocaleString('en-US', { ...KST_OPTS, day: 'numeric' });
  const dayName = DAYS[new Date(d.toLocaleString('en-US', KST_OPTS)).getDay()];
  const hour = parseInt(d.toLocaleString('en-US', { ...KST_OPTS, hour: 'numeric', hour12: false }), 10);
  const ampm = hour < 12 ? '오전' : '오후';
  return `${y}년 ${M}월 ${dd}일 ${dayName} ${ampm}`;
}

/** 두 ISO 문자열이 KST 기준 서로 다른 날짜인지 */
function isDifferentDay(a: string, b: string): boolean {
  return new Date(a).toLocaleDateString('ko-KR', KST_OPTS) !==
         new Date(b).toLocaleDateString('ko-KR', KST_OPTS);
}

// ---- DateSeparator 컴포넌트 ----

function DateSeparator({ iso }: { iso: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 8px' }}>
      <span
        style={{
          fontSize: '12px',
          color: '#8E8E93',
          background: '#F2F2F7',
          borderRadius: '12px',
          padding: '4px 12px',
        }}
      >
        {formatDateLabel(iso)}
      </span>
    </div>
  );
}

interface Props {
  roomId: string;
  targetMessageId?: string;
  onShowRecent?: () => void;
  /** 상대방 이름 (직접 채팅에서 표시용). 미지정 시 sender_id 기반 "사용자" */
  peerName?: string;
}

export function ChatRoom({ roomId, peerName, targetMessageId, onShowRecent }: Props) {
  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messagesByRoom[roomId]);
  // store는 최신순 저장 → 일반 flex-col용으로 오래된 순으로 뒤집기
  // HOOK-STATE-02: 렌더마다 새 배열을 만들면 아래 IntersectionObserver effect 가
  // msgList 참조 변화로 매 렌더 재생성된다 — messages 기준으로 안정 참조를 유지한다.
  const msgList = useMemo(() => (messages ? [...messages].reverse() : []), [messages]);
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateSenderName = useChatStore((s) => s.updateSenderName);
  const clearRoomUnread = useChatStore((s) => s.clearRoomUnread);
  const setActiveRoom = useChatStore((s) => s.setActiveRoom);

  const [dismissedTarget, setDismissedTarget] = useState<string | null>(null);
  const target = dismissedTarget === `${roomId}:${targetMessageId}` ? undefined : targetMessageId;
  const [targetError, setTargetError] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 전송 실패한 본문을 보관한다 — 배너의 '다시보내기'가 같은 내용을 재전송한다.
  const [failedContent, setFailedContent] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const keyboardHeight = useKeyboardHeight();
  // HOOK-STATE-05: 가변 길이 deps 대신 단일 트리거(문자열)를 넘겨 의존성 배열 길이를 고정한다.
  const { handleScroll, scrollToBottom } = useAutoScroll(listRef, `${msgList.length}:${loading}`, !target);

  useEffect(() => {
    setDismissedTarget(null);
  }, [roomId, targetMessageId]);

  // 쿼리 변경마다 재탐색하고 이전 요청의 늦은 응답은 무시한다.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTargetError(null);
    setHighlightedId(null);
    void (async () => {
      try {
        const recent = await listChatMessages(roomId);
        if (cancelled) return;
        if (!target || recent.messages.some((message) => message.id === target)) {
          setMessages(roomId, recent.messages);
          return;
        }
        try {
          const around = await listChatMessagesAround(roomId, target);
          if (cancelled) return;
          if (around.messages.some((message) => message.id === target)) {
            setMessages(roomId, [...around.messages].sort((a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
          } else {
            setMessages(roomId, []);
            setTargetError('해당 메시지를 찾을 수 없습니다');
          }
        } catch {
          if (!cancelled) {
            setMessages(roomId, []);
            setTargetError('해당 메시지를 불러올 수 없습니다');
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setMessages(roomId, []);
          if (target) setTargetError('해당 메시지를 불러올 수 없습니다');
          else setError(err instanceof Error ? err.message : '메시지 로딩 실패');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, target, setMessages]);

  useEffect(() => {
    // 읽음 처리 — 사이드바 배지만 초기화 (내 메시지의 "1"은 messages_read 이벤트로만 사라짐)
    clearRoomUnread(roomId);
    markRoomRead(roomId)
      .then(() => useNotificationStore.getState().fetch())
      .catch(() => { /* 조용히 실패 */ });
    // 현재 보고 있는 방 활성화 (다른 방 메시지 unread 증가 방지)
    setActiveRoom(roomId);
    return () => {
      setActiveRoom(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // 메시지 로딩 완료 후 최하단 스크롤
  useEffect(() => {
    if (!target && !loading && msgList.length > 0) {
      const timer = setTimeout(() => scrollToBottom(), 100);
      return () => clearTimeout(timer);
    }
  }, [target, loading, msgList.length, scrollToBottom]);

  // WebSocket 실시간 수신
  const token = useAuthStore((s) => s.accessToken);
  useEffect(() => {
    if (!roomId || !token) return;

    const socket: Socket = getChatSocket(token);
    socket.emit('join_room', { room_id: roomId });

    const handleNewMessage = (msg: ChatMessage): void => {
      if (msg.room_id !== roomId) return;
      // 내가 보낸 메시지는 handleSend에서 이미 추가됨 (중복 방지)
      if (user && msg.sender_id === user.id) return;
      appendMessage(roomId, msg);
    };

    socket.on('new_message', handleNewMessage);

    const handleProfileUpdated = (payload: { user_id: string; name: string }): void => {
      updateSenderName(payload.user_id, payload.name);
    };
    socket.on('profile_updated', handleProfileUpdated);

    // 읽음 상태 업데이트 (messages_read 이벤트)
    // 백엔드 페이로드: { room_id, reader_id, messages?: [{id, unread_count, read_by}], read_count? }
    const handleMessagesRead = (payload: {
      room_id: string;
      reader_id: string;
      messages?: Array<{ id: string; read_count?: number; unread_count: number; read_by?: string[] }>;
    }): void => {
      const store = useChatStore.getState();

      // 사이드바 뱃지 즉시 갱신
      store.clearRoomUnread(payload.room_id);

      // 낙관적 업데이트: 모든 메시지 unread_count → 0 + read_by 갱신
      // (reader_id가 보낸 메시지는 markAllMessagesRead 내부에서 건너뜀)
      store.markAllMessagesRead(payload.room_id, payload.reader_id);

      // API 재호출 없음 — markAllMessagesRead로 UI가 이미 정확함
    };
    socket.on('messages_read', handleMessagesRead);

    const handleReconnect = (): void => {
      socket.emit('join_room', { room_id: roomId });
    };
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('profile_updated', handleProfileUpdated);
      socket.off('messages_read', handleMessagesRead);
      socket.off('connect', handleReconnect);
      socket.emit('leave_room', { room_id: roomId });
    };
  }, [roomId, token, appendMessage, updateSenderName, user]);

  // ── IntersectionObserver: 스크롤 읽음 처리 ──
  const messageElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const readSentRef = useRef<Set<string>>(new Set());
  const readQueueRef = useRef<string[]>([]);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading || !target || targetError) return;
    const element = messageElRefs.current.get(target);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    element.focus({ preventScroll: true });
    setHighlightedId(target);
    const timer = setTimeout(() => setHighlightedId(null), 3000);
    return () => clearTimeout(timer);
  }, [roomId, target, loading, targetError]);

  const showRecent = () => {
    setDismissedTarget(`${roomId}:${targetMessageId}`);
    onShowRecent?.();
  };

  // 배치 요청: 300ms 동안 모아서 한 번에 전송
  const flushReadQueue = useCallback(() => {
    const ids = readQueueRef.current;
    readQueueRef.current = [];
    if (ids.length === 0) return;
    markMessagesRead(roomId, ids).catch(() => { /* 조용히 실패 */ });
  }, [roomId]);

  useEffect(() => {
    if (loading || !user) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const mid = (entry.target as HTMLElement).dataset.messageId;
          if (!mid) continue;
          // 이미 읽음 처리 전송했으면 스킵
          if (readSentRef.current.has(mid)) continue;
          // 시스템 메시지나 내 메시지는 스킵
          const msg = msgList.find((m) => m.id === mid);
          if (!msg) continue;
          if (msg.type === 'system') continue;
          if (msg.sender_id === user.id) continue;
          // 이미 내가 읽었다면 스킵 (read_by에 내 ID가 있으면)
          if (msg.read_by?.includes(user.id)) continue;

          readSentRef.current.add(mid);
          readQueueRef.current.push(mid);

          // 300ms debounce
          if (readTimerRef.current) clearTimeout(readTimerRef.current);
          readTimerRef.current = setTimeout(flushReadQueue, 300);
        }
      },
      { threshold: 0.5 }, // 메시지의 50% 이상 보이면 읽음 처리
    );

    // 메시지가 렌더링된 후 observer에 등록
    const timer = setTimeout(() => {
      messageElRefs.current.forEach((el) => {
        observer.observe(el);
      });
    }, 200);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      if (readTimerRef.current) {
        flushReadQueue();
        clearTimeout(readTimerRef.current);
      }
    };
  }, [loading, user, msgList, roomId, flushReadQueue]);

  // 방 전환 시 readSent 초기화
  useEffect(() => {
    readSentRef.current = new Set();
    readQueueRef.current = [];
  }, [roomId]);

  const handleSend = useCallback(
    // overrideContent: 실패 배너의 '다시보내기'가 직전 본문을 그대로 재전송할 때 쓴다.
    async (overrideContent?: string): Promise<void> => {
      const content = (overrideContent ?? input).trim();
      if (!content || (target && (loading || targetError))) return;
      setInput('');
      try {
        const msg = await sendChatMessage(roomId, { content, type: 'text' });
        appendMessage(roomId, msg);
        setError(null);
        setFailedContent(null);
        scrollToBottom();
      } catch (err: unknown) {
        setFailedContent(content);
        setError(err instanceof Error ? err.message : '전송 실패');
      }
    },
    [input, roomId, appendMessage, scrollToBottom, target, loading, targetError],
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {target && !loading && (
        <div className="px-4 py-2 text-sm bg-purple-50 shrink-0" role="status">
          {targetError ?? '알림의 메시지 위치를 보고 있습니다.'}
          <button type="button" onClick={showRecent} className="ml-3 text-[#5F0080] underline">최근 대화 보기</button>
        </div>
      )}
      {/* 메시지 리스트 */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-2"
      >
        {loading ? (
          <div className="text-center text-gray-500 py-4">{target ? '메시지 위치를 찾고 있습니다' : '메시지를 불러오는 중…'}</div>
        ) : targetError ? null : msgList.length === 0 ? (
          <div className="text-center text-gray-500 py-4">아직 메시지가 없습니다</div>
        ) : (
          msgList.map((m, idx, arr) => {
            const showDateSep =
              idx === 0 || isDifferentDay(arr[idx - 1].created_at, m.created_at);
            const isMine = !!user && m.sender_id === user.id;
            // 같은 발신자의 연속 메시지인지 (시스템 메시지 제외)
            const prevMsg = idx > 0 ? arr[idx - 1] : null;
            const isSameSender =
              prevMsg &&
              prevMsg.type !== 'system' &&
              prevMsg.sender_id === m.sender_id;
            const showSender = !isMine && !isSameSender;
            const senderName = !isMine ? (m.sender_name || peerName || '사용자') : undefined;
            const item =
              m.type === 'system' ? (
                <SystemMessage key={m.id} content={m.content} createdAt={m.created_at} />
              ) : (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isMine={isMine}
                  senderName={senderName}
                  showSender={showSender}
                />
              );
            // 메시지에 ref 등록 + data-message-id (IntersectionObserver용)
            const setRef = (el: HTMLDivElement | null) => {
              if (el) {
                messageElRefs.current.set(m.id, el);
              } else {
                messageElRefs.current.delete(m.id);
              }
            };
            const wrapped = (
              <div key={m.id} ref={setRef} data-message-id={m.id} tabIndex={-1}
                className={highlightedId === m.id ? 'rounded-xl bg-purple-100 ring-2 ring-purple-300' : undefined}>
                {highlightedId === m.id && <span className="px-2 text-xs text-[#5F0080]">알림의 메시지</span>}
                {item}
              </div>
            );
            return showDateSep ? (
              <div key={`group-${m.id}`}>
                <DateSeparator iso={m.created_at} />
                {wrapped}
              </div>
            ) : (
              wrapped
            );
          })
        )}
      </div>

      {error && (
        <div role="alert" className="px-4 py-1.5 text-xs text-red-600 bg-red-50 shrink-0 flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          {failedContent && (
            <button
              type="button"
              onClick={() => void handleSend(failedContent)}
              className="shrink-0 font-semibold text-red-700 underline"
            >
              다시보내기
            </button>
          )}
        </div>
      )}

      {/* 입력창 */}
      <div
        className="border-t border-[#EFEFEF] p-3 flex gap-2 bg-white shrink-0"
        style={{ paddingBottom: `calc(0.75rem + ${keyboardHeight}px)` }}
      >
        <input
          ref={inputRef}
          type="text"
          disabled={!!target && (loading || !!targetError)}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="메시지를 입력하세요"
          className="flex-1 min-w-0 h-11 px-4 rounded-xl border border-[#DDDEE7] bg-white text-base text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15 transition"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!input.trim() || (!!target && (loading || !!targetError))}
          className="mb-btn shrink-0 disabled:opacity-50"
        >
          전송
        </button>
      </div>
    </div>
  );
}
