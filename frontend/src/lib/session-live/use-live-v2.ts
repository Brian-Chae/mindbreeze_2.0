// SDD-246 T06 — LiveClient 를 React 에 연결하는 훅. 플래그 off 이면 아무 것도 만들지 않는다(현행 경로 유지).
import { useEffect, useMemo, useState } from 'react';
import { apiClient, tokenStorage } from '../api/client';
import { getSessionLiveSocket } from '../socket';
import { LiveClient, type LiveSocketLike } from './live-client';
import { isLiveProtocolV2Enabled } from './live-flag';
import { createRestFallback } from './live-rest';
import type { LiveState } from './live-state';
import { toSessionLiveMetrics } from './live-legacy-adapter';
import type { SessionLiveMetric } from '../api/session';
import type { LegacyIdentity } from './live-view';

const uuid = (): string => crypto.randomUUID();

export interface UseLiveV2Options {
  sessionId: string | null | undefined;
  selfParticipantId: string | null;
  enabled: boolean;
  entryCredential?: string | null;
  /** 게스트(비로그인) — 소켓에 access token 을 싣지 않는다 */
  skipAuth?: boolean;
}

export interface UseLiveV2Result {
  active: boolean;
  state: LiveState | null;
  /** effect 가 만든 뒤 state 로 노출 — 첫 렌더에서는 null 이다 */
  client: LiveClient | null;
  /** 1초마다 갱신되는 시계(서버 시각 추정) — 신선도 경과(3초 지연/10초 stale)가 이벤트 없이도 화면에 반영된다 */
  nowMs: number;
  /** READY 이면 REST 폴링이 불필요하다(페이지가 자기 폴링을 멈추는 기준) */
  ready: boolean;
  rows: (legacy?: readonly LegacyIdentity[]) => SessionLiveMetric[];
}

export function useLiveV2({ sessionId, selfParticipantId, enabled, entryCredential, skipAuth = false }: UseLiveV2Options): UseLiveV2Result {
  const active = enabled && isLiveProtocolV2Enabled() && Boolean(sessionId);
  const [state, setState] = useState<LiveState | null>(null);
  const [client, setClient] = useState<LiveClient | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const instanceId = useMemo(() => uuid(), []);

  useEffect(() => {
    if (!active || !sessionId) return undefined;
    const socket = getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess()) as unknown as LiveSocketLike;
    const next = new LiveClient({
      sessionId,
      selfParticipantId,
      socket,
      rest: createRestFallback(apiClient),
      uuid,
      clientInstanceId: instanceId,
      appBuild: 'web',
      capabilities: ['paint_ack'],
      entryCredential: entryCredential ?? null,
    });
    const unsub = next.subscribe(setState);
    next.start();
    setState(next.getState());
    setClient(next);
    return () => {
      unsub();
      next.stop();
      setClient(null);
      setState(null);
    };
  }, [active, sessionId, selfParticipantId, instanceId, entryCredential, skipAuth]);

  useEffect(() => {
    if (!active) return undefined;
    // observed_at_ms 는 서버 시계 기준이다 — 로컬 시계가 어긋나도 경과 판정이 틀어지지 않게 서버 시각 추정을 쓴다.
    const t = window.setInterval(() => setNowMs(client ? client.serverNowMs() : Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active, client]);

  return {
    active,
    state,
    client,
    nowMs,
    ready: state?.phase === 'READY',
    rows: (legacy) => (state ? toSessionLiveMetrics(state, { nowMs, legacy }) : []),
  };
}
