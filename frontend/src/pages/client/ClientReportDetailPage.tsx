// 내담자용 리포트 상세 — AppShell 없음, 승인 버튼 없음
// EEG: 어댑터 기반, 상위 지표 + 쉬운 라벨, not_measured 시 미노출

import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import EegQualityBanner from '../../components/reports/EegQualityBanner';
import EegMetricsGrid from '../../components/reports/EegMetricsGrid';
import EegTimeline from '../../components/reports/EegTimeline';
import NarrativeSections from '../../components/reports/NarrativeSections';
import ReportCoverSection from '../../components/reports/ReportCoverSection';
import {
  getReport,
  adaptReportContent,
  type ReportDto,
} from '../../lib/api/reports';

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
  const location = useLocation();
  const id = location.pathname.match(/\/app\/reports\/([^/]+)$/)?.[1];
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
  const { summary, insights, displayNarrative } = adapted;
  const eeg = adapted.eeg;
  // SDD-085: 마이크 오프(수동 기록) 세션 — AI 요약 섹션 숨김 + 사유 표기
  const aiRecordUnavailable = adapted.aiRecord?.status === 'not_available';
  const aiRecordReasonText =
    adapted.aiRecord?.reason === 'mic_off'
      ? '이 세션은 마이크를 사용하지 않아 AI 자동 기록(전사·요약)이 제공되지 않습니다.'
      : '이 세션에는 AI 자동 기록(전사·요약)이 없습니다.';
  // SDD-087 — 상담사 코멘트 (내담자에게 전달되는 메시지)
  const counselorComment =
    (report.content?.counselor_comment as string | undefined)?.trim() || null;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        {/* Cover — 서사 우선, 종합점수 대형 노출 없음 (SDD-054) */}
        <ReportCoverSection report={report} adapted={adapted} />

        {displayNarrative && <NarrativeSections narrative={displayNarrative} />}

        {aiRecordUnavailable && (
          <div className="rounded-2xl border border-[#EFEFEF] bg-white p-5 text-sm text-[#6F6F6F]">
            {aiRecordReasonText}
          </div>
        )}

        {/* SDD-087 — 상담사 코멘트 (있을 때만) */}
        {counselorComment && (
          <SummaryCard title="상담사 코멘트">
            <p className="text-[15px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
              {counselorComment}
            </p>
          </SummaryCard>
        )}

        {!aiRecordUnavailable && summary && (
          <SummaryCard title="AI 요약">
            <p className="text-[15px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
              {summary}
            </p>
          </SummaryCard>
        )}

        {!aiRecordUnavailable && insights.length > 0 && (
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
