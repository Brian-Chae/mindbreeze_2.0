// 내담자 홈 화면 (오늘 탭)
// 상담사 필터 탭 + 다음 세션 카드 + 최근 리포트 요약

import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { listSessions, type SessionDto } from '../../lib/api/session';
import { listReports, type ReportDto } from '../../lib/api/reports';

type Counselor = { id: string; name: string; profile_image: string | null };

/** 상태 한글 뱃지 */
function statusLabel(status: string): string {
  switch (status) {
    case 'scheduled':
      return '예정';
    case 'in_progress':
      return '진행중';
    case 'completed':
      return '완료';
    case 'cancelled':
      return '취소';
    default:
      return status;
  }
}

/** 세션 날짜/시간 포맷 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 리포트 날짜 포맷 */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export default function ClientHomePage() {
  const user = useAuthStore((s) => s.user);
  const counselors: Counselor[] = user?.counselors ?? [];

  const [selectedCounselorId, setSelectedCounselorId] = useState<string>('all');
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [loading, setLoading] = useState(true);

  // 데이터 로딩
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [sessRes, repRes] = await Promise.all([
          listSessions().catch(() => ({ sessions: [] as SessionDto[], total: 0 })),
          listReports().catch(() => ({ reports: [] as ReportDto[], total: 0 })),
        ]);
        if (cancelled) return;
        setSessions(sessRes.sessions);
        setReports(repRes.reports);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 필터링된 세션
  const filteredSessions = useMemo(() => {
    if (selectedCounselorId === 'all') return sessions;
    return sessions.filter((s) =>
      s.participants?.some(
        (p) => p.user_id === selectedCounselorId
      )
    );
  }, [sessions, selectedCounselorId]);

  // 다음 세션 (예정 또는 진행중, scheduled_at 기준 가장 가까운)
  const nextSession = useMemo(() => {
    const upcoming = filteredSessions
      .filter((s) => s.status === 'scheduled' || s.status === 'in_progress')
      .sort(
        (a, b) =>
          new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      );
    return upcoming[0] ?? null;
  }, [filteredSessions]);

  // 최근 리포트 (created_at 기준 최신 1개)
  const latestReport = useMemo(() => {
    const sorted = [...reports].sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime()
    );
    return sorted[0] ?? null;
  }, [reports]);

  // 선택된 상담사 이름 (전체가 아닐 때)
  const selectedCounselorName = useMemo(() => {
    if (selectedCounselorId === 'all') return null;
    return counselors.find((c) => c.id === selectedCounselorId)?.name ?? null;
  }, [counselors, selectedCounselorId]);

  return (
    <div className="pb-4">
      {/* 상담사 필터 탭 (좌우 스크롤) */}
      <div className="overflow-x-auto no-scrollbar px-4 py-2">
        <div className="flex gap-2 min-w-max">
          {/* "전체" 탭 */}
          <button
            type="button"
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              selectedCounselorId === 'all'
                ? 'bg-[#5F0080] text-white'
                : 'bg-[#EFEFEF] text-[#1F1F1F]'
            }`}
            onClick={() => setSelectedCounselorId('all')}
          >
            전체
          </button>

          {/* 상담사별 탭 */}
          {counselors.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                selectedCounselorId === c.id
                  ? 'bg-[#5F0080] text-white'
                  : 'bg-[#EFEFEF] text-[#1F1F1F]'
              }`}
              onClick={() => setSelectedCounselorId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-12 text-center text-[#6F6F6F] text-sm">
          불러오는 중...
        </div>
      ) : (
        <>
          {/* 다음 세션 카드 */}
          <div className="px-4 mt-2">
            <h2 className="text-sm font-semibold text-[#1F1F1F] mb-2">
              {selectedCounselorName
                ? `${selectedCounselorName}님과의 다음 세션`
                : '다음 세션'}
            </h2>

            {nextSession ? (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-base font-bold text-[#1F1F1F]">
                    {nextSession.title ?? '제목 없음'}
                  </h3>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      nextSession.status === 'in_progress'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-[#F3E5F5] text-[#5F0080]'
                    }`}
                  >
                    {statusLabel(nextSession.status)}
                  </span>
                </div>
                <p className="text-sm text-[#6F6F6F]">
                  {formatDateTime(nextSession.scheduled_at)}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9B9B9B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <p className="text-sm text-[#6F6F6F]">아직 예정된 세션이 없어요</p>
              </div>
            )}
          </div>

          {/* 최근 리포트 요약 */}
          <div className="px-4 mt-3">
            <h2 className="text-sm font-semibold text-[#1F1F1F] mb-2">
              최근 리포트
            </h2>

            {latestReport ? (
              <div className="bg-white rounded-2xl shadow-sm p-4">
                <h3 className="text-base font-bold text-[#1F1F1F] mb-1">
                  {latestReport.session_title ?? '리포트'}
                </h3>
                <p className="text-sm text-[#6F6F6F]">
                  {formatDate(latestReport.created_at)}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9B9B9B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <p className="text-sm text-[#6F6F6F]">아직 리포트가 없어요</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
