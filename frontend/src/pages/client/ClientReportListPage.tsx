// 내담자용 리포트 목록 페이지
// AppShell 없이 ClientShell 내에서 동작

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReports, type ReportDto } from '../../lib/api/reports';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function TypeBadge({ type }: { type: string }) {
  const isCounselor = type === 'counselor';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold font-mono ${
        isCounselor ? 'bg-[#F5EDFC] text-[#5F0080]' : 'bg-[#E6F4EA] text-[#2E7D32]'
      }`}
    >
      {isCounselor ? '상담사용' : '내담자용'}
    </span>
  );
}

function StatusBadge({ sentAt }: { sentAt: string | null }) {
  if (sentAt) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#E0F2FE] text-[#075985]">
        승인됨
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#FEF3C7] text-[#92400E]">
      검토중
    </span>
  );
}

/** 빈 상태 컴포넌트 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#9B9B9B"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mb-3"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
      <p className="text-sm font-medium text-[#1F1F1F] mb-1">아직 리포트가 없어요</p>
      <p className="text-xs text-[#6F6F6F]">세션을 마치면 리포트를 확인할 수 있습니다</p>
    </div>
  );
}

export default function ClientReportListPage() {
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReports()
      .then((r) => {
        if (cancelled) return;
        setReports(r.reports);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '리포트 조회 실패');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pb-4">
      {/* 헤더 */}
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-lg font-bold text-[#1F1F1F]">리포트</h2>
        <p className="text-xs text-[#6F6F6F] font-mono uppercase tracking-wider">AI REPORTS</p>
      </div>

      {error && (
        <div className="mx-4 mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-[#6F6F6F] text-sm text-center py-12">불러오는 중...</div>
      ) : reports.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="px-4 grid grid-cols-1 gap-3">
          {reports.map((r) => {
            const headline = (r.content?.headline as string) ?? '리포트';
            const score = (r.content?.score as number) ?? null;
            return (
              <Link
                key={r.id}
                to={`/app/reports/${r.id}`}
                className="block bg-white border border-[#EFEFEF] rounded-2xl p-4 hover:shadow-md hover:border-[#5F0080]/30 transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <TypeBadge type={r.type} />
                  <StatusBadge sentAt={r.sent_at} />
                </div>
                <div className="font-bold text-[15px] text-[#1F1F1F] mb-1 truncate">
                  {r.session_title || headline}
                </div>
                <div className="text-[11px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">
                  {r.session_type ?? '-'} · {formatDate(r.scheduled_at ?? r.created_at)}
                </div>
                {score !== null && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[24px] font-extrabold text-[#5F0080]">{score}</span>
                    <span className="text-[11px] text-[#6F6F6F]">/ 100</span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
