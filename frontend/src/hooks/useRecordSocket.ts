// WebSocket `/record` 네임스페이스 — AI 처리 상태 실시간 구독

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { tokenStorage } from '../lib/api/client';

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'http://localhost:8000';

export type RecordStatus =
  | 'merging'
  | 'transcribing'
  | 'diarizing'
  | 'summarizing'
  | 'completed'
  | 'failed';

interface RecordStatusEvent {
  session_id: string;
  status: RecordStatus;
  detail?: Record<string, unknown>;
}

interface UseRecordSocketReturn {
  status: RecordStatus | null;
  detail: Record<string, unknown> | null;
  subscribe: (sessionId: string) => void;
  unsubscribe: () => void;
  isConnected: boolean;
}

const STATUS_LABELS: Record<RecordStatus, string> = {
  merging: '청크 병합 중',
  transcribing: '음성 인식 중',
  diarizing: '화자 분리 중',
  summarizing: 'AI 요약 중',
  completed: '완료',
  failed: '처리 실패',
};

export const RECORD_STATUS_LABELS = STATUS_LABELS;

export function useRecordSocket(): UseRecordSocketReturn {
  const [status, setStatus] = useState<RecordStatus | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<string | null>(null);

  const connect = useCallback(() => {
    if (socketRef.current) return;

    const token = tokenStorage.getAccess();
    const socket = io(`${WS_URL}/record`, {
      path: '/socket.io',
      auth: token ? { token } : {},
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('record_status', (event: RecordStatusEvent) => {
      if (event.session_id === sessionRef.current) {
        setStatus(event.status);
        setDetail(event.detail ?? null);
      }
    });

    socketRef.current = socket;
  }, []);

  const subscribe = useCallback(
    (sessionId: string) => {
      sessionRef.current = sessionId;
      if (!socketRef.current) connect();
      const socket = socketRef.current;
      if (!socket) return;

      if (socket.connected) {
        socket.emit('subscribe', { session_id: sessionId });
      } else {
        socket.once('connect', () => {
          socket.emit('subscribe', { session_id: sessionId });
        });
      }
      setStatus(null);
      setDetail(null);
    },
    [connect],
  );

  const unsubscribe = useCallback(() => {
    const socket = socketRef.current;
    const sid = sessionRef.current;
    if (socket && sid) {
      socket.emit('unsubscribe', { session_id: sid });
    }
    sessionRef.current = null;
    setStatus(null);
    setDetail(null);
  }, []);

  useEffect(() => {
    return () => {
      const socket = socketRef.current;
      if (socket) {
        socket.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  return { status, detail, subscribe, unsubscribe, isConnected };
}
