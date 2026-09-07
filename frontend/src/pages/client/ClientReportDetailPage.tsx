// 내담자용 리포트 상세 — AppShell 없음, 승인 버튼 없음
// EEG: 어댑터 기반, 상위 지표 + 쉬운 라벨, not_measured 시 미노출

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import EegQualityBanner from '../../components/reports/EegQualityBanner';
import EegMetricsGrid from '../../components/reports/EegMetricsGrid';
import EegTimeline from '../../components/reports/EegTimeline';
import {
  getReport,
  adaptReportContent,
  type AdaptedReportContent,
  type ReportDto,
} from '../../lib/api/reports';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function CoverSection({
  report,
  adapted,
}: {
  report: ReportDto;
  adapted: AdaptedReportContent;
}) {
  const headline = adapted.headline ?? '리포트';
  const sessionTitle = report.session_title || headline;
  const sessionType = report.session_type ?? '-';
  const score = adapted.coverScore;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#5F0080] via-[#7B00A6] to-[#9B30FF] p-8 text-white">
      <div className="absolute inset-0 opacity-10">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="dots2" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots2)" />
        </svg>
      </div>

      <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white/20">
              내담자용
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white/20">
              {sessionType}
            </span>
            {adapted.coverReasonChip && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-400/25 text-amber-50 border border-amber-200/30">
                {adapted.coverReasonChip}
              </span>
            )}
          </div>
          <h1 className="text-[28px] font-extrabold tracking-tight mb-2">
            {sessionTitle}
          </h1>
          <div className="text-[14px] text-white/70 font-mono">
            {formatDate(report.scheduled_at ?? report.created_at)}
          </div>
          {report.sent_at && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/15 text-[12px] font-bold">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              확인 가능
            </div>
          )}
        </div>

        {score !== null && (
          <div className="flex-shrink-0">
            <div className="bg-white/10 backdrop-blur rounded-2xl px-6 py-5 text-center border border-white/10">
              <div className="text-[12px] text-white/60 font-mono uppercase tracking-wider mb-1">
                오늘의 두뇌휴식
              </div>
              <div className="text-[48px] font-extrabold leading-none">
                {score}
              </div>
              <div className="text-[13px] text-white/50 mt-1">/ 100</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
      <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-sm bg-[#5F0080]" />
        {title}
      </h3>
      {children}
    </div>
  );
}

export default function ClientReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getReport(id)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
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
  }, [id]);

  const handleGeneratePDF = useCallback(async () => {
    if (!id) return;
    alert('PDF 생성 기능은 추후 제공됩니다.');
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="text-[#6F6F6F] text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] p-6">
        <div className="max-w-4xl mx-auto">
          <div className="p-4 rounded-xl bg-red-50 text-red-700 text-sm mb-4">{error}</div>
          <button
            onClick={() => navigate('/app/reports')}
            className="px-5 py-2.5 rounded-xl bg-white border border-[#EFEFEF] text-[14px] text-[#1F1F1F] hover:bg-[#F5F5F5] transition-colors"
          >
            목록으로
          </button>
        </div>
      </div>
    );
  }

  if (!report) return null;

  // 내담자 뷰로 강제 — 라벨·접힘 비대칭
  const adapted = adaptReportContent(report.content, 'client');
  const { summary, insights } = adapted;
  const eeg = adapted.eeg;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        <CoverSection report={report} adapted={adapted} />

        {summary && (
          <SummaryCard title="AI 요약">
            <p className="text-[15px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
              {summary}
            </p>
          </SummaryCard>
        )}

        {insights.length > 0 && (
          <SummaryCard title="인사이트 카드">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {insights.map((insight, i) => (
                <div
                  key={i}
                  className="bg-gradient-to-br from-[#F5EDFC] to-white border border-[#EFEFEF] rounded-xl p-4"
                >
                  <div className="text-[12px] text-[#6F6F6F] font-mono mb-1">
                    INSIGHT {String(i + 1).padStart(2, '0')}
                  </div>
                  <p className="text-[14px] text-[#1F1F1F] leading-relaxed">{insight}</p>
                </div>
              ))}
            </div>
          </SummaryCard>
        )}

        {/* EEG — not_measured면 미마운트. 마커는 내담자 미노출 */}
        {adapted.showEegSection && eeg && (
          <div className="space-y-4" data-testid="eeg-section">
            <EegQualityBanner eeg={eeg} reportType="client" />
            {adapted.showEegMetrics && (
              <EegMetricsGrid eeg={eeg} reportType="client" />
            )}
            {adapted.showEegTimeline && (
              <EegTimeline data={adapted.eeg_timeline} dense />
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-4 border-t border-[#EFEFEF]">
          <button
            onClick={() => navigate('/app/reports')}
            className="px-5 py-2.5 rounded-xl bg-white border border-[#EFEFEF] text-[14px] text-[#1F1F1F] hover:bg-[#F5F5F5] transition-colors"
          >
            목록으로
          </button>

          {report.pdf_url ? (
            <a
              href={report.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-xl bg-white border border-[#EFEFEF] text-[14px] text-[#1F1F1F] hover:bg-[#F5F5F5] transition-colors"
            >
              PDF 다운로드
            </a>
          ) : report.sent_at ? (
            <button
              onClick={handleGeneratePDF}
              className="px-5 py-2.5 rounded-xl bg-white border border-[#EFEFEF] text-[14px] text-[#1F1F1F] hover:bg-[#F5F5F5] transition-colors"
            >
              PDF 생성
            </button>
          ) : null}
        </div>

        <p className="text-center text-[11px] text-[#9B9B9B] pb-4">
          본 리포트는 의료 진단이 아닌 두뇌건강 관리 목적의 참고 자료입니다.
        </p>
      </div>
    </div>
  );
}
