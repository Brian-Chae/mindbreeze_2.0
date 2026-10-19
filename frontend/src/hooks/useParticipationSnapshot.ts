import { useEffect, useState } from 'react';
import { getParticipation, type ParticipationRow, type ParticipationSnapshot } from '../lib/api/participation';
import { getSessionLiveSocket } from '../lib/socket';
import { useAuthStore } from '../stores/authStore';

interface ParticipationState {
  sessionId: string | null;
  classId: string | null;
  participants: Readonly<Record<string, ParticipationRow>>;
  version: number;
  revoked: boolean;
}
const initial: ParticipationState = { sessionId:null, classId:null, participants: {}, version: -1, revoked: false };
/** 상태 버전과 독립적으로 복원한다. 조회 중 이벤트는 버퍼링하고 gap은 서버에서 재확인한다. */
export function useParticipationSnapshot({classId, sessionId}: {classId?: string | null; sessionId?: string | null}): ParticipationState {
  const token = useAuthStore(s => s.accessToken);
  const [state, setState] = useState<ParticipationState>(initial);
  useEffect(() => {
    setState(initial);
    if (!classId || !sessionId) return;
    let disposed = false;
    let revoked = false;
    let loading = false;
    let version = -1;
    let rows: Record<string, ParticipationRow> = {};
    let buffered: ParticipationSnapshot[] = [];
    let retryAt = 0;
    let needsRetry = false;
    const socket = getSessionLiveSocket(token);
    const publish = (): void => { if (!disposed) setState({sessionId, classId, participants:{...rows}, version, revoked}); };
    const valid = (event: ParticipationSnapshot): boolean => event.session_id === sessionId && Number.isInteger(event.participation_version) && Array.isArray(event.participants);
    const apply = (event: ParticipationSnapshot): void => {
      version = event.participation_version;
      rows = Object.fromEntries(event.participants.map(p => [p.participant_id, p]));
      publish();
    };
    const refresh = async (): Promise<void> => {
      if (disposed || revoked || loading) return;
      loading = true;
      try {
        const result = await getParticipation(classId, sessionId);
        if (disposed || revoked || !valid(result)) return;
        needsRetry = false;
        if (result.participation_version >= version) apply(result);
        const queue = buffered.sort((a,b)=>a.participation_version-b.participation_version);
        buffered = [];
        for (const [index,event] of queue.entries()) {
          if (event.participation_version <= version) continue;
          if (event.participation_version !== version + 1) {
            buffered.push(...queue.slice(index));
            retryAt = 0;
            break;
          }
          apply(event);
        }
      } catch {
        if (!disposed && !revoked) {
          // 체크인·출석은 유지하고 만료된 현재 접속만 미확인으로 표시한다.
          rows = Object.fromEntries(Object.entries(rows).map(([id,p]) => [id,
            p.presence_state === 'connected' && (!p.presence_expires_at || Date.parse(p.presence_expires_at) <= Date.now())
              ? {...p,presence_state:'unknown',presence_expires_at:null} : p]));
          publish();
          needsRetry = true;
          retryAt = Date.now() + 30000;
        }
      } finally {
        loading = false;
      }
    };
    const delta = (event: ParticipationSnapshot): void => {
      if (disposed || revoked || !valid(event) || event.participation_version <= version) return;
      if (loading || version < 0) { buffered.push(event); return; }
      if (event.participation_version !== version + 1) { buffered.push(event); void refresh(); return; }
      apply(event);
    };
    const joined = (event: {session_id?: string; snapshot?: ParticipationSnapshot}): void => {
      if (event.session_id !== sessionId) return;
      if (event.snapshot && valid(event.snapshot)) delta(event.snapshot);
      void refresh();
    };
    const connect = (): void => { void refresh(); };
    const revoke = (event: {session_id?: string}): void => {
      if (event.session_id !== sessionId) return;
      revoked = true; rows = {}; buffered = []; publish();
    };
    socket.on('participant_changed', delta);
    socket.on('joined', joined);
    socket.on('connect', connect);
    socket.on('access_revoked', revoke);
    void refresh();
    const timer = window.setInterval(() => {
      if (revoked || disposed || Date.now() < retryAt) return;
      const expired = Object.values(rows).some(p => p.presence_state === 'connected' && p.presence_expires_at && Date.parse(p.presence_expires_at) <= Date.now());
      if (expired || buffered.length > 0 || needsRetry) void refresh();
    }, 1000);
    return () => {
      disposed = true; window.clearInterval(timer);
      socket.off('participant_changed', delta); socket.off('joined', joined);
      socket.off('connect', connect); socket.off('access_revoked', revoke);
    };
  }, [classId, sessionId, token]);
  return state.sessionId === sessionId && state.classId === classId ? state : {...initial, sessionId:sessionId ?? null, classId:classId ?? null};
}
