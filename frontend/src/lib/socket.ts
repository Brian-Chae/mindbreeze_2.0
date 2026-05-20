// Socket.IO 클라이언트 싱글톤 — /chat 네임스페이스 전용 헬퍼

import { io, Socket } from 'socket.io-client';

const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL as string | undefined) ??
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/api\/v1\/?$/, '') ??
  'http://localhost:8000';

let chatSocket: Socket | null = null;

export const getChatSocket = (token: string): Socket => {
  if (chatSocket && chatSocket.connected) return chatSocket;
  if (chatSocket) {
    chatSocket.disconnect();
  }
  chatSocket = io(`${SOCKET_URL}/chat`, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
  return chatSocket;
};

export const disconnectChatSocket = (): void => {
  if (chatSocket) {
    chatSocket.disconnect();
    chatSocket = null;
  }
};
