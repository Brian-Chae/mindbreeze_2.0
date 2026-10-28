// Socket.IO 알림 리스너 훅 — 채팅 네임스페이스에 연결해 new_notification 수신

import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useChatStore } from '../stores/chatStore';
import { getChatRoom } from '../lib/api/chat';
import { invalidateSharedReads } from '../lib/api/client';
import type { NotificationExtra } from '../lib/api/notifications';
// HOOK-STATE-01 / WS-05: /chat 소켓은 getChatSocket() 싱글톤을 재사용한다.
// io()로 직접 생성하면 채팅 화면(ChatRoom·ClassChatPanel)과 함께 /chat 네임스페이스가
// 2중 연결되고, cleanup 의 socket.off(event) 가 공유 소켓의 다른 리스너까지 제거한다.
import { getChatSocket } from '../lib/socket';
import { invalidateClassReads } from '../lib/class-structure/invalidation';

// 최초 연결은 seed 요청을 공유하고, 재연결은 놓친 이벤트를 복구한다.
const connectedSockets = new WeakSet<Socket>();

export function useNotificationSocket() {
  const token = useAuthStore((s) => s.accessToken);
  const fetch = useNotificationStore((s) => s.fetch);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) console.log('[WS] useEffect running, hasToken:', !!token);
    if (!token) {
      console.warn('[WS] no token, skipping socket connection');
      return;
    }

    // 싱글톤 재사용 — ChatRoom/ClassChatPanel 과 동일 인스턴스를 공유한다.
    const socket: Socket = getChatSocket(token);

    socketRef.current = socket;
    let disposed = false;

    const handleConnect = (): void => {
      if (import.meta.env.DEV) console.log('[WS] socket.io connected');
      // 최초 연결은 진행 중 seed만 공유한다. 완료된 seed는 연결 직전 누락을 재확인한다.
      const firstConnection = !connectedSockets.has(socket);
      invalidateSharedReads('notifications', firstConnection);
      invalidateSharedReads('chat', firstConnection);
      connectedSockets.add(socket);
      useNotificationStore.getState().setWsConnected(true);
      fetch();
      // 세션 초대 목록도 연결 시 새로고침 — 홈/세션 화면의 "초대된 클래스" 카드용
      void useNotificationStore.getState().refreshSessionInvites();
    };

    const handleConnectError = (err: Error): void => {
      console.error('[WS] socket.io connect error:', err.message);
      useNotificationStore.getState().setWsConnected(false);
    };

    const handleDisconnect = (reason: string): void => {
      console.warn('[WS] socket.io disconnect:', reason);
      useNotificationStore.getState().setWsConnected(false);
    };

    const handleNewNotification = (data: { id?: string; type?: string; title?: string; body?: string; extra?: NotificationExtra | null }): void => {
      // 수신 직전 진행 중이던 조회까지 폐기하고 최신 배지를 즉시 가져온다.
      invalidateSharedReads('notifications');
      if (data.type === 'chat') invalidateSharedReads('chat');
      fetch();
      void useNotificationStore.getState().refreshSessionInvites();
      // SDD-250: 클래스·회차 계열 알림이면 홈 '다음 일정'이 쓰는 클래스 목록을 즉시 다시 읽는다.
      if (data.extra?.target_type === 'class' || data.extra?.target_type === 'session') invalidateClassReads();
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
    };

    // 선택한 방의 메시지/읽음/프로필 이벤트도 다음 메뉴의 목록 재사용을 무효화한다.
    const invalidateRooms = () => invalidateSharedReads('chat');
    socket.on('new_message', invalidateRooms);
    socket.on('messages_read', invalidateRooms);
    socket.on('profile_updated', invalidateRooms);
    if (socket.connected) connectedSockets.add(socket);
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);
    socket.on('new_notification', handleNewNotification);

    // 최초 카운트 + 초대 목록 (연결 전에도 초기 시드)
    fetch();
    void useNotificationStore.getState().refreshSessionInvites();

    return () => {
      disposed = true;
      // 공유 싱글톤이므로 disconnect 하지 않고 이 훅이 등록한 리스너만 해제한다.
      // (socket.off(event) 단독 호출은 다른 컴포넌트의 리스너까지 제거한다.)
      socket.off('new_message', invalidateRooms);
      socket.off('messages_read', invalidateRooms);
      socket.off('profile_updated', invalidateRooms);
      socket.off('new_notification', handleNewNotification);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
    };
  }, [token, fetch]);
}
