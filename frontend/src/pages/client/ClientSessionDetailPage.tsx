// 내담자 클래스 상세 페이지 (SDD-209 FM03)
// 히어로(유형·상태·방식·안내) + 준비물 3줄 + 하단 주 버튼 1개. 입장은 초대된 회원 편의 경로(useEnterClass)로 한다.
// SDD-088: 입장 버튼 단일화 + open 상태 대기실 반영
// 실시간 반영: 상담사가 원격에서 상태를 바꾸면 /session-live WS(session_state_changed)로 즉시 갱신,
// WS 미연결 시 5초 폴링 폴백으로 자동 갱신(수동 새로고침 불필요).

import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { getSession, type SessionDto, type SessionStatus } from '../../lib/api/session';
import { useAuthStore } from '../../stores/authStore';
import { ClientReportDetailModal } from './ClientReportDetailModal';
import ClientShell from '../../components/client/ClientShell';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import { useEnterClass } from '../../hooks/useEnterClass';
import { deriveDetailAction } from '../../lib/class/enter-action';
import { ClassDetailBody, ClassDetailFoot } from '../../components/class/flow/shell/ClassDetailView';
import { toDetailData, type SessionWithHost } from '../../components/class/flow/shell/shell-data';
import '../../components/class/flow/shell/shell-kit.css';
import type { SessionLiveJoinSnapshot, SessionStateChangedEvent } from '../../lib/socket';

export default function ClientSessionDetailPage() {
  // ClientAppPage가 Route 없이 조건부 렌더링하므로 useParams 대신 pathname에서 id 파싱
  const location = useLocation();
  const id = location.pathname.match(/\/app\/sessions\/([^/]+)$/)?.[1];
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const counselors = user?.counselors ?? [];
  const { enter, enteringId, error: enterError } = useEnterClass();

  const [reportOpen, setReportOpen] = useState(false);
  const [session, setSession] = useState<SessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getSession(id)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // 실시간 상태 반영 — join snapshot(초기 상태)과 session_state_changed(전이)를 세션 상태에 머지
  const applyStatus = useCallback(
    (status: SessionStatus | string, started_at?: string | null, ended_at?: string | null) => {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: status as SessionStatus,
              started_at: started_at ?? prev.started_at,
              ended_at: ended_at ?? prev.ended_at,
            }
          : prev,
      );
    },
    [],
  );

  const handleSnapshot = useCallback(
    (snap: SessionLiveJoinSnapshot) => {
      applyStatus(snap.status, snap.started_at, snap.ended_at);
    },
    [applyStatus],
  );

  const handleSessionStateChanged = useCallback(
    (event: SessionStateChangedEvent) => {
      applyStatus(event.status, event.started_at, event.ended_at);
    },
    [applyStatus],
  );

  const { isReady } = useSessionLiveSocket({
    sessionId: id,
    onSnapshot: handleSnapshot,
    onSessionStateChanged: handleSessionStateChanged,
  });

  // WS 폴백: 스냅샷을 아직 못 받으면(미연결·비참가자) 5초 폴링으로 상태 자동 갱신
  useEffect(() => {
    if (!id || isReady) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      getSession(id)
        .then((s) => {
          if (!cancelled) setSession(s);
        })
        .catch(() => { /* 조용히 실패 — 다음 주기에 재시도 */ });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, isReady]);

  // 진행자 이름: 서버가 내려주는 host_name 우선, 없으면 담당 상담사 목록에서 찾는다
  const detail = (() => {
    if (!session) return null;
    const hostName = (session as SessionWithHost).host_name ?? counselors.find((c) => c.id === session.host_id)?.name ?? null;
    return toDetailData({ ...session, host_name: hostName });
  })();
  const action = detail ? deriveDetailAction(detail.chip) : null;

  const handleAction = (): void => {
    if (!session || !action) return;
    if (action.kind === 'enter') void enter(session.id);
    else if (action.kind === 'report') setReportOpen(true);
    else if (action.kind === 'list') navigate('/app/sessions');
  };

  // 뒤로가기
  const handleBack = (): void => {
    navigate('/app/sessions');
  };

  return (
    <ClientShell title="클래스 상세">
      <div className="sh-scope">
        <div className="sh-col">
          <button type="button" onClick={handleBack} className="inline-flex min-h-[44px] items-center gap-1 self-start text-sm text-[#6F6F6F] hover:text-[#1F1F1F] transition-colors">
            <ChevronLeft size={20} aria-hidden="true" />클래스 목록
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm text-[#6F6F6F]">불러오는 중...</div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p role="alert" className="text-sm text-red-500">{error}</p>
              <button type="button" onClick={handleBack} className="min-h-[44px] text-sm text-[#5F0080] font-medium underline">
                목록으로 돌아가기
              </button>
            </div>
          ) : detail && action ? (
            <>
              <ClassDetailBody data={detail} />
              <ClassDetailFoot
                inline
                note={action.note}
                action={action}
                onAction={handleAction}
                busy={enteringId === session?.id}
                error={enterError ? { message: enterError.message, needsCode: enterError.kind === 'invite-required' } : null}
                onEnterWithCode={() => navigate('/join')}
              />
            </>
          ) : null}
        </div>
      </div>
      {reportOpen && session && (
        <ClientReportDetailModal sessionId={session.id} onClose={() => setReportOpen(false)} />
      )}
    </ClientShell>
  );
}
