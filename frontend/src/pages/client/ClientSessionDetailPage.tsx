// 내담자 세션 상세 페이지
// 세션 정보, 상태별 액션 버튼, 뒤로가기
// SDD-088: 입장 버튼 단일화 + open 상태 대기실 반영
// 실시간 반영: 상담사가 원격에서 상태를 바꾸면 /session-live WS(session_state_changed)로 즉시 갱신,
// WS 미연결 시 5초 폴링 폴백으로 자동 갱신(수동 새로고침 불필요).

import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSession, type SessionDto, type SessionStatus } from '../../lib/api/session';
import { useAuthStore } from '../../stores/authStore';
import { ClientReportDetailModal } from './ClientReportDetailModal';
import ClientShell from '../../components/client/ClientShell';
import { StatusBadge } from '../../components/session/StatusBadge';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import type { SessionLiveJoinSnapshot, SessionStateChangedEvent } from '../../lib/socket';

/** 날짜/시간 포맷 */
function formatDateTime(iso: string | null): string {
  if (!iso) return '즉시 클래스';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 세션 유형 라벨 */
function typeLabel(type: string): string {
  switch (type) {
    case 'clinical': return '임상심리상담';
    case 'hypnosis': return '최면심리상담';
    case 'meditation': return '명상수업';
    case 'custom': return '기타';
    default: return type;
  }
}

export default function ClientSessionDetailPage() {
  // ClientAppPage가 Route 없이 조건부 렌더링하므로 useParams 대신 pathname에서 id 파싱
  const location = useLocation();
  const id = location.pathname.match(/\/app\/sessions\/([^/]+)$/)?.[1];
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const counselors = user?.counselors ?? [];

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

  // 상담사 이름 찾기
  const counselorName = (() => {
    if (!session) return '상담사';
    const counselor = counselors.find((c) => c.id === session.host_id);
    return counselor?.name ?? '상담사';
  })();

  // 상태별 액션 렌더링
  const renderActions = (): React.ReactNode => {
    if (!session) return null;

    if (session.status === 'ready' || session.status === 'scheduled' || session.status === 'open' || session.status === 'in_progress' || session.status === 'paused') {
      // SDD-088: 입장 활성 조건 — 오픈(대기실 개방) 이후부터. ready/scheduled 는 "아직 열리지 않음".
      const canEnter =
        session.status === 'open' || session.status === 'in_progress' || session.status === 'paused';
      return (
        <div className="flex flex-col md:flex-row gap-2">
          {canEnter ? (
            <button
              type="button"
              onClick={() => {
                if (session.access_code) {
                  navigate(`/join?code=${session.access_code}`);
                }
              }}
              className="w-full rounded-xl bg-[#5F0080] text-white text-sm font-semibold py-3 active:scale-[0.98] transition-transform"
            >
              세션 입장하기
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="w-full rounded-xl bg-[#D4D4D4] text-white text-sm font-semibold py-3 cursor-not-allowed"
            >
              세션 입장하기 (아직 열리지 않음)
            </button>
          )}
        </div>
      );
    }

    if (session.status === 'completed') {
      return (
        <div className="flex flex-col md:flex-row gap-2">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setReportOpen(true)}
            className="w-full rounded-xl bg-[#5F0080] text-white text-sm font-semibold py-3 active:scale-[0.98] transition-transform"
          >
            리포트 보기
          </button>
        </div>
      );
    }

    if (session.status === 'cancelled') {
      return (
        <div className="bg-[#FDECEC] rounded-xl p-4 text-center">
          <p className="text-sm text-[#B3261E] font-medium">취소된 세션입니다</p>
        </div>
      );
    }

    return null;
  };

  // 뒤로가기
  const handleBack = (): void => {
    navigate('/app/sessions');
  };

  return (
    <ClientShell title="세션 상세" sub="SESSION DETAIL">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* 뒤로 가기 + 상태 뱃지 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="text-sm text-[#6F6F6F] hover:text-[#1F1F1F] transition-colors"
          >
            ← 세션 목록으로
          </button>
          {session && <StatusBadge status={session.status} />}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-[#6F6F6F]">
            불러오는 중...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-sm text-red-500">{error}</p>
            <button
              type="button"
              onClick={handleBack}
              className="text-sm text-[#5F0080] font-medium underline"
            >
              목록으로 돌아가기
            </button>
          </div>
        ) : session ? (
          <>
            {/* 세션 정보 카드 */}
            <div className="bg-white rounded-[20px] border border-[#EFEFEF] p-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#F5EDFC] text-[#5F0080]">
                  {typeLabel(session.type)}
                </span>
              </div>
              <h1 className="text-xl font-bold text-[#1F1F1F]">
                {session.title || '제목 없음'}
              </h1>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-[#6F6F6F] mb-0.5">상담사</dt>
                  <dd className="text-sm text-[#1F1F1F] font-medium">{counselorName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#6F6F6F] mb-0.5">날짜/시간</dt>
                  <dd className="text-sm text-[#1F1F1F] font-medium">
                    {formatDateTime(session.scheduled_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#6F6F6F] mb-0.5">소요 시간</dt>
                  <dd className="text-sm text-[#1F1F1F] font-medium">{session.duration_min}분</dd>
                </div>
                {session.notes && (
                  <div>
                    <dt className="text-xs text-[#6F6F6F] mb-0.5">메모</dt>
                    <dd className="text-sm text-[#1F1F1F] whitespace-pre-wrap leading-relaxed">
                      {session.notes}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* 액션 버튼 */}
            {renderActions()}
          </>
        ) : null}
      </div>
      {reportOpen && session && (
        <ClientReportDetailModal sessionId={session.id} onClose={() => setReportOpen(false)} />
      )}
    </ClientShell>
  );
}
