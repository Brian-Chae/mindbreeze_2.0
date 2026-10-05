// Socket.IO 알림 리스너 훅 — 채팅 네임스페이스에 연결해 new_notification 수신

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useChatStore } from '../stores/chatStore';
import { getChatRoom } from '../lib/api/chat';
import type { NotificationExtra } from '../lib/api/notifications';
// FE-RT-002: 소켓 URL 단일 출처 — /session-live·/record 와 동일한 값을 쓴다.
import { SOCKET_URL } from '../lib/socket';

export function useNotificationSocket() {
  const token = useAuthStore((s) => s.accessToken);
  const fetch = useNotificationStore((s) => s.fetch);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    console.log('[WS] useEffect running, hasToken:', !!token);
    if (!token) {
      console.warn('[WS] no token, skipping socket connection');
      return;
    }

    const socket: Socket = io(`${SOCKET_URL}/chat`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
      autoConnect: true,
      reconnection: true,
    });

    socketRef.current = socket;
    let disposed = false;

    socket.on('connect', () => {
      console.log('[WS] socket.io connected to', SOCKET_URL);
      useNotificationStore.getState().setWsConnected(true);
      fetch();
      // 세션 초대 목록도 연결 시 새로고침 — 홈/세션 화면의 "초대된 클래스" 카드용
      void useNotificationStore.getState().refreshSessionInvites();
    });

    socket.on('connect_error', (err) => {
      console.error('[WS] socket.io connect error:', err.message);
      useNotificationStore.getState().setWsConnected(false);
    });

    socket.on('disconnect', (reason) => {
      console.warn('[WS] socket.io disconnect:', reason);
      useNotificationStore.getState().setWsConnected(false);
    });

    socket.on('new_notification', (data: { id?: string; type?: string; title?: string; body?: string; extra?: NotificationExtra | null }) => {
      // 알림 도착 → unread count 갱신
      fetch();
      // 세션 초대 알림 → 홈/세션 화면 "초대된 클래스" 카드에 실시간 반영
      if (data.extra?.event_type === 'session_invited') {
        const sessionId =
          typeof data.extra.target_id === 'string'
            ? data.extra.target_id
            : typeof data.extra.session_id === 'string'
              ? data.extra.session_id
              : undefined;
        if (sessionId) {
          useNotificationStore.getState().addSessionInvite({
            sessionId,
            notificationId: data.id ?? '',
          });
        }
      }
      const roomId = data.extra?.room_id;
      const { activeRoomId } = useChatStore.getState();
      const isViewingRoom = roomId && activeRoomId === roomId;
      // 현재 보고 있는 채팅방이면 토스트 표시 안 함
      if (data?.title && !isViewingRoom) {
        useNotificationStore.getState().showToast({
          id: data.id ?? `${Date.now()}`,
          type: data.type ?? 'info',
          title: data.title ?? '',
          body: data.body ?? '',
          roomId,
          extra: data.extra ?? null,
        });
      }
      // 미선택 방은 메시지 전문을 수신하지 않아 서버의 정확한 미리보기/시각을 조회한다.
      if (data.type === 'chat' && roomId) {
        void getChatRoom(roomId).then((room) => {
          if (disposed) return;
          const store = useChatStore.getState();
          if (!store.rooms.some((item) => item.id === roomId)) {
            store.setRooms([...store.rooms, room]);
          } else if (room.last_message) {
            store.updateRoomLastMessage(roomId, room.last_message);
          }
        }).catch(() => { /* 재진입 시 목록 조회로 복구한다. */ });
      }
      // 채팅 알림이면 사이드바 채팅 unread도 증가 (보고 있는 방 제외)
      if (data.type === 'chat' && roomId && !isViewingRoom) {
        useChatStore.getState().incrementUnread(roomId);
      }
    });

    // 최초 카운트 + 초대 목록 (연결 전에도 초기 시드)
    fetch();
    void useNotificationStore.getState().refreshSessionInvites();

    return () => {
      disposed = true;
      socket.off('new_notification');
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
      socket.disconnect();
    };
  }, [token, fetch]);
}
