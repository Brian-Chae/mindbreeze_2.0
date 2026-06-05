// LINK BAND EEG WebSocket 훅 — `/eeg` 네임스페이스

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';

export interface EEGMetrics {
  neural_activity: number;
  concentration: number;
  cognitive_stress: number;
  eeg_stress: number;
  emotional_balance: number;
  relaxation: number;
  heart_rate: number;
  total_movement: number;
  sensor_attached: number;
  sqi_fp1: number;
  sqi_fp2: number;
}

export interface EEGDataPoint {
  session_id: string;
  user_id: string;
  timestamp: number;
  metrics: EEGMetrics;
}

export interface EEGAlert {
  type: 'sensor_detached' | 'sqi_critical' | 'sqi_warning';
  user_id: string;
  message: string;
  level: 'warning' | 'critical';
  sqi_fp1?: number;
  sqi_fp2?: number;
}

interface ParticipantInfo {
  sid: string;
  user_id: string;
}

export function useEEGSocket(sessionId: string | undefined) {
  const socketRef = useRef<Socket | null>(null);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [latestMetrics, setLatestMetrics] = useState<Map<string, EEGDataPoint>>(new Map());
  const [alerts, setAlerts] = useState<EEGAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const token = useAuthStore((s) => s.accessToken);

  const SOCKET_URL =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/api\/v1\/?$/, '') ??
    import.meta.env.VITE_API_URL?.replace(/\/api\/v1\/?$/, '') ??
    'https://dev-api.mindbreeze.looxidlabs.com';

  useEffect(() => {
    if (!sessionId || !token) return;

    const socket = io(`${SOCKET_URL}/eeg`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token },
      autoConnect: true,
      reconnection: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', { session_id: sessionId, user_id: 'counselor' });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('participant_joined', (info: ParticipantInfo) => {
      setParticipants((prev) => [...prev.filter((p) => p.sid !== info.sid), info]);
    });

    socket.on('participant_left', (info: { sid: string }) => {
      setParticipants((prev) => prev.filter((p) => p.sid !== info.sid));
    });

    socket.on('metrics', (data: EEGDataPoint) => {
      setLatestMetrics((prev) => {
        const next = new Map(prev);
        next.set(data.user_id, data);
        return next;
      });
    });

    socket.on('alert', (alert: EEGAlert) => {
      setAlerts((prev) => [...prev.slice(-9), alert]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, token]);

  const clearAlerts = useCallback(() => setAlerts([]), []);

  return {
    connected,
    participants,
    latestMetrics,
    alerts,
    clearAlerts,
  };
}
