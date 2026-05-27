// Socket.IO 알림 리스너 훅 — 채팅 네임스페이스에 연결해 new_notification 수신

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useChatStore } from '../stores/chatStore';

const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL as string | undefined) ??
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/api\/v1\/?$/, '') ??
  'http://localhost:8000';

export function useNotificationSocket() {
  const token = useAuthStore((s) => s.accessToken);
  const fetch = useNotificationStore((s) => s.fetch);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket: Socket = io(`${SOCKET_URL}/chat`, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
      autoConnect: true,
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] socket.io connected to', SOCKET_URL);
      fetch();
    });

    socket.on('connect_error', (err) => {
      console.error('[WS] socket.io connect error:', err.message);
    });

    socket.on('disconnect', (reason) => {
      console.warn('[WS] socket.io disconnect:', reason);
    });

    socket.on('new_notification', (data: { id?: string; type?: string; title?: string; body?: string; extra?: { room_id?: string } }) => {
      // 알림 도착 → unread count 갱신
      fetch();
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
        });
      }
      // 채팅 알림이면 사이드바 채팅 unread도 증가 (보고 있는 방 제외)
      if (data.type === 'chat' && roomId && !isViewingRoom) {
        useChatStore.getState().incrementUnread(roomId);
      }
    });

    // 최초 카운트
    fetch();

    return () => {
      socket.off('new_notification');
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
      socket.disconnect();
    };
  }, [token, fetch]);
}
