// WebSocket `/record` 네임스페이스 — AI 처리 상태 실시간 구독
// FE-RT-004: io() 직접 생성 대신 lib/socket.ts 싱글톤을 쓴다 — useReportProgress 와
// 연결을 공유해 기록 화면에서 /record 가 2중 연결되는 문제를 제거한다. 이 훅은 자기
// 리스너만 해제하고, 소켓 수명은 acquire/release 참조 카운트가 관리한다.

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { tokenStorage } from '../lib/api/client';
// FE-RT-002/FE-RT-004: 소켓 URL·/record 싱글톤 단일 출처.
import { acquireRecordSocket, releaseRecordSocket } from '../lib/socket';

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
  /** 이 훅이 등록한 리스너만 해제하기 위한 정리 함수(공유 소켓에서 다른 훅 리스너를 건드리지 않음) */
  const cleanupRef = useRef<(() => void) | null>(null);

  const ensureSocket = useCallback((): Socket => {
    const existing = socketRef.current;
    if (existing) return existing;

    const token = tokenStorage.getAccess();
    const socket = acquireRecordSocket(token);
    socketRef.current = socket;

    const onConnect = (): void => {
      setIsConnected(true);
      // SDD-137: 재연결 시 기존 구독 방을 자동 재구독 — 끊겼다 복구되면 기록 갱신이 멈추지 않도록
      const sid = sessionRef.current;
      if (sid) socket.emit('subscribe', { session_id: sid });
    };
    const onDisconnect = (): void => setIsConnected(false);
    const onRecordStatus = (event: RecordStatusEvent): void => {
      if (event.session_id === sessionRef.current) {
        setStatus(event.status);
        setDetail(event.detail ?? null);
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('record_status', onRecordStatus);
    cleanupRef.current = () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('record_status', onRecordStatus);
    };

    // 이미 연결된 공유 소켓을 즉시 재사용한 경우에도 상태를 반영한다.
    if (socket.connected) setIsConnected(true);
    return socket;
  }, []);

  const subscribe = useCallback(
    (sessionId: string) => {
      sessionRef.current = sessionId;
      const socket = ensureSocket();

      // HOOK-STATE-07: 미연결 시 'connect' once 리스너를 중복 등록하지 않는다.
      // ensureSocket 의 영구 onConnect 가 sessionRef 기반으로 재구독하므로,
      // 연결되면 그 경로에서 정확히 1회 subscribe 가 emit 된다.
      if (socket.connected) {
        socket.emit('subscribe', { session_id: sessionId });
      }
      setStatus(null);
      setDetail(null);
    },
    [ensureSocket],
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
      cleanupRef.current?.();
      cleanupRef.current = null;
      // acquire 했을 때만 release — 소켓은 useReportProgress 와 공유되므로 참조 카운트로 정리한다.
      if (socketRef.current) {
        releaseRecordSocket();
        socketRef.current = null;
      }
      setIsConnected(false);
    };
  }, []);

  return { status, detail, subscribe, unsubscribe, isConnected };
}
