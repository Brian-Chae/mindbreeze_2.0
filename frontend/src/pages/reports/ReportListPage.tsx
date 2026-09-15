// AI 리포트 목록 페이지

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReportSampleModal } from './ReportSamplePage';
import AppShell from '../../components/layout/AppShell';
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

export default function ReportListPage() {
  const [sampleOpen, setSampleOpen] = useState(false);
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listReports()
      .then((r) => setReports(r.reports))
      .catch((e) => setError(e instanceof Error ? e.message : '리포트 조회 실패'))
      .finally(() => setLoading(false));
  }, []);

  const sampleLink = (
    <button
      type="button"
      onClick={() => setSampleOpen(true)}
      className="inline-flex items-center h-9 px-4 rounded-full text-[13px] font-semibold text-[#5F0080] bg-[#F5EDFC] border border-[#E8D9F5] hover:bg-[#EFE3FA] transition-colors"
    >
      샘플 보기
    </button>
  );

  return (
    <AppShell title="리포트" sub="AI REPORTS" rightSlot={!loading ? sampleLink : undefined}>
      {!loading && <div className="mb-4 md:hidden">{sampleLink}</div>}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
      )}
      {loading ? (
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      ) : reports.length === 0 ? (
        <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-12 text-center">
          <div className="text-[#6F6F6F] text-sm">아직 생성된 리포트가 없습니다.</div>
          <div className="text-[#9B9B9B] text-xs mt-1">세션을 마치면 리포트를 생성할 수 있습니다.</div>
          <button
            type="button"
            onClick={() => setSampleOpen(true)}
            className="inline-flex items-center mt-5 h-10 px-5 rounded-full text-[13px] font-bold text-white bg-[#5F0080] hover:bg-[#4A0066] transition-colors"
          >
            샘플 리포트 보기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((r) => {
            const headline = (r.content?.headline as string) ?? '리포트';
            const score = (r.content?.score as number) ?? null;
            return (
              <Link
                key={r.id}
                to={`/reports/${r.id}`}
                className="block bg-white border border-[#EFEFEF] rounded-2xl p-5 hover:shadow-md hover:border-[#5F0080]/30 transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <TypeBadge type={r.type} />
                  <StatusBadge sentAt={r.sent_at} />
                </div>
                <div className="font-bold text-[16px] text-[#1F1F1F] mb-1 truncate">
                  {r.session_title || headline}
                </div>
                <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-3">
                  {r.session_type ?? '-'} · {formatDate(r.scheduled_at ?? r.created_at)}
                </div>
                {score !== null && (
                  <div className="flex items-baseline gap-1.5 mt-3">
                    <span className="text-[28px] font-extrabold text-[#5F0080]">{score}</span>
                    <span className="text-[12px] text-[#6F6F6F]">/ 100</span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
      {sampleOpen && <ReportSampleModal onClose={() => setSampleOpen(false)} />}
    </AppShell>
  );
}
