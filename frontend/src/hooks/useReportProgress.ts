// SDD-095 — 리포트 생성 진행 상태 실시간 구독 훅
//
// 세션 종료 후 STT → 화자분리 → AI 요약 → 리포트 생성은 수 분 걸린다.
//  · Socket.IO `/record` 네임스페이스의 `report:progress` 이벤트를 구독한다.
//  · 소켓 누락/미연결에 대비해 REST(/sessions/{id}/report-status) 폴링을 병행한다.
//  · 완료(ready/partial)로 '전이'될 때 조용한 토스트를 1회만 띄운다(요란한 팝업 금지).

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { tokenStorage } from '../lib/api/client';
import {
  getSessionReportStatus,
  isReportGenerationDone,
  parseReportProgress,
  type ReportGenerationStatus,
  type ReportProgressDto,
} from '../lib/api/report-status';
import { useNotificationStore } from '../stores/notificationStore';
// FE-RT-002: 소켓 URL 단일 출처 — /session-live·/chat 과 동일한 값을 쓴다.
import { SOCKET_URL } from '../lib/socket';

/** 폴링 기본 주기 — 소켓이 살아 있어도 진행률 누락을 복구한다. */
const DEFAULT_POLL_MS = 5000;

interface UseReportProgressOptions {
  /** 완료 전이 시 조용한 토스트 1회(기본 true) */
  notifyOnComplete?: boolean;
  /** 폴링 주기(ms). 0 이면 폴링 비활성 */
  pollMs?: number;
}

export interface UseReportProgressReturn {
  /** 서버 진행 계약(미조회 시 null) */
  progress: ReportProgressDto | null;
  generationStatus: ReportGenerationStatus | null;
  /** 생성 종료(ready | partial) */
  isComplete: boolean;
  /** 진행 중(processing) — 스텝퍼 노출 조건 */
  isProcessing: boolean;
  isConnected: boolean;
  /** 즉시 1회 재조회 */
  refresh: () => Promise<void>;
}

export function useReportProgress(
  sessionId: string | null | undefined,
  options: UseReportProgressOptions = {},
): UseReportProgressReturn {
  const { notifyOnComplete = true, pollMs = DEFAULT_POLL_MS } = options;

  // 세션 스냅샷 — 세션 전환 시 파생값이 자동으로 null 이 되도록 sid 를 함께 보관한다
  // (effect 본문에서 setState(null) 로 리셋하지 않는다 — cascading render 방지).
  const [snapshot, setSnapshot] = useState<{ sid: string; progress: ReportProgressDto } | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 이미 완료 토스트를 띄운 세션 — 중복 토스트 방지(1회) */
  const notifiedRef = useRef<Set<string>>(new Set());
  /** 완료 토스트는 '전이'에서만 — 이미 완료 상태로 진입한 화면에서는 띄우지 않는다. */
  const sawPendingRef = useRef<Set<string>>(new Set());

  const apply = useCallback(
    (next: ReportProgressDto | null, sid: string) => {
      if (!next) return;
      setSnapshot({ sid, progress: next });

      const done = isReportGenerationDone(next.generation_status);
      if (!done) {
        sawPendingRef.current.add(sid);
        return;
      }
      // 완료 전이 1회만 — 처음부터 완료(=다른 화면에서 이미 봤을 수 있음)면 알리지 않는다.
      if (!sawPendingRef.current.has(sid) || notifiedRef.current.has(sid)) return;
      notifiedRef.current.add(sid);
      if (!notifyOnComplete) return;
      useNotificationStore.getState().showToast({
        id: `report-progress-${sid}`,
        type: 'report_ready',
        title: '리포트가 준비되었어요',
        body:
          next.generation_status === 'ready'
            ? '세션이 끝나고 만든 AI 리포트를 확인해보세요.'
            : '일부 내용만 담긴 리포트가 준비되었어요. 기록 페이지에서 확인할 수 있어요.',
      });
    },
    [notifyOnComplete],
  );

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await getSessionReportStatus(sessionId);
      apply(next, sessionId);
    } catch {
      /* 조용히 실패 — 폴링/소켓이 다음 기회에 복구한다 */
    }
  }, [sessionId, apply]);

  /** 현재 세션의 진행 계약 — 다른 세션의 스냅샷은 노출하지 않는다. */
  const progress = sessionId && snapshot?.sid === sessionId ? snapshot.progress : null;

  // 초기 조회 + 폴링
  useEffect(() => {
    if (!sessionId) return;
    // effect 본문에서 동기 setState 를 피한다 — 마이크로태스크로 첫 조회를 예약한다.
    const kickoff = setTimeout(() => {
      void refresh();
    }, 0);

    if (pollMs > 0) {
      pollRef.current = setInterval(() => {
        void refresh();
      }, pollMs);
    }
    return () => {
      clearTimeout(kickoff);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [sessionId, pollMs, refresh]);

  // 완료되면 폴링 중단(추가 조회는 무의미하다)
  useEffect(() => {
    if (!progress || !isReportGenerationDone(progress.generation_status)) return;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [progress]);

  // Socket.IO `/record` 구독 — 서버 push 우선, 폴링은 보완
  useEffect(() => {
    if (!sessionId) return;

    const token = tokenStorage.getAccess();
    const socket = io(`${SOCKET_URL}/record`, {
      path: '/socket.io',
      auth: token ? { token } : {},
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    const subscribe = (): void => {
      socket.emit('subscribe', { session_id: sessionId });
    };

    socket.on('connect', () => {
      setIsConnected(true);
      subscribe();
    });
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('report:progress', (payload: unknown) => {
      const parsed = parseReportProgress(payload);
      if (!parsed) return;
      if (parsed.session_id && parsed.session_id !== sessionId) return;
      apply(parsed, sessionId);
    });

    return () => {
      socket.off('report:progress');
      socket.off('connect');
      socket.off('disconnect');
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [sessionId, apply]);

  const generationStatus = progress?.generation_status ?? null;

  return {
    progress,
    generationStatus,
    isComplete: isReportGenerationDone(generationStatus),
    isProcessing: generationStatus === 'processing',
    isConnected,
    refresh,
  };
}
