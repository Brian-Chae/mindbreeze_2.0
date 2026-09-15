// AI 리포트 상세 페이지 — SDD-045 서사형
// 순서: Cover(점수 최소화) → 서사(종합→몸→마음→마무리) → 상담 본문 → EEG 보조(7지표/타임라인)
// LINK BAND 미착용(not_measured) 시 EEG 섹션 DOM 미노출

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import EegQualityBanner from '../../components/reports/EegQualityBanner';
import EegMetricsGrid from '../../components/reports/EegMetricsGrid';
import EegTimeline from '../../components/reports/EegTimeline';
import NarrativeSections from '../../components/reports/NarrativeSections';
import ReportCoverSection from '../../components/reports/ReportCoverSection';
import ReportStatusBadge from '../../components/reports/ReportStatusBadge';
import { useAuthStore } from '../../stores/authStore';
import {
  getReport,
  approveReport,
  resendReportEmail,
  adaptReportContent,
  canApproveReport,
  resolveDataCredibility,
  resolveReportStatus,
  type ReportDto,
} from '../../lib/api/reports';
import type { EegQualityStatus } from '../../lib/api/report';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 접힌 EEG 요약줄용 짧은 품질 라벨 (SDD-056) */
function eegQualitySummaryLabel(status: EegQualityStatus): string | null {
  switch (status) {
    case 'valid':
      return '품질 양호';
    case 'degraded':
      return '품질 주의';
    case 'invalid':
      return '품질 미달';
    case 'insufficient':
      return '데이터 부족';
    default:
      return null;
  }
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

function MarkerBadge({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4 bg-[#F5EDFC] rounded-xl">
      <span className="text-[13px] font-medium text-[#1F1F1F]">{label}</span>
      <span className="text-[14px] font-bold text-[#5F0080]">{value}</span>
    </div>
  );
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const userRole = useAuthStore((s) => s.user?.role);
  const isCounselorUser = userRole === 'counselor';
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getReport(id)
      .then((r) => {
        setReport(r);
        setResendEmail(r.report_email ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : '리포트 조회 실패'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleApprove = useCallback(async () => {
    if (!id) return;
    setApproving(true);
    setError(null);
    try {
      await approveReport(id);
      setApproved(true);
      const updated = await getReport(id);
      setReport(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '승인 처리 실패');
    } finally {
      setApproving(false);
    }
  }, [id]);

  const handleGeneratePDF = useCallback(async () => {
    if (!id) return;
    alert('PDF 생성 기능은 추후 제공됩니다.');
  }, [id]);

  const handleResendEmail = useCallback(async () => {
    if (!id) return;
    const email = resendEmail.trim();
    setResendSuccess(null);
    setResendError(null);
    if (!email || !EMAIL_RE.test(email)) {
      setResendError('올바른 이메일 주소를 입력해 주세요.');
      return;
    }
    setResending(true);
    try {
      await resendReportEmail(id, email);
      setResendSuccess(`${email}로 리포트 메일을 재발송했습니다.`);
    } catch (e) {
      setResendError(e instanceof Error ? e.message : '메일 재발송에 실패했습니다.');
    } finally {
      setResending(false);
    }
  }, [id, resendEmail]);

  if (loading) {
    return (
      <AppShell title="리포트 상세" sub="AI REPORT DETAIL">
        <div className="text-[#6F6F6F]">불러오는 중...</div>
      </AppShell>
    );
  }

  if (error && !report) {
    return (
      <AppShell title="리포트 상세" sub="AI REPORT DETAIL">
        <div className="p-4 rounded-xl bg-red-50 text-red-700 text-sm mb-4">{error}</div>
        <button
          onClick={() => navigate('/reports')}
          className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
        >
          목록으로
        </button>
      </AppShell>
    );
  }

  if (!report) return null;

  const adapted = adaptReportContent(report.content, report.type);
  const { summary, insights, markers, displayNarrative } = adapted;
  const isCounselor = report.type === 'counselor';
  const eeg = adapted.eeg;
  const pipelineStatus = resolveReportStatus(report);
  const credibility = resolveDataCredibility(
    report.data_credibility,
    eeg?.status ?? null,
  );
  const showApprove = isCounselor && canApproveReport({
    status: report.status,
    sent_at: report.sent_at,
    alreadyApprovedLocally: approved,
  });
  const showResendEmail = isCounselorUser && report.type === 'client';

  return (
    <AppShell title="리포트 상세" sub="BODY · MIND REPORT">
      <div className="max-w-4xl mx-auto space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        {/* 1. Cover — 서사 우선, 종합점수 대형 노출 없음 */}
        <ReportCoverSection report={report} adapted={adapted} />

        <ReportStatusBadge
          status={pipelineStatus}
          credibility={credibility}
          showApprovalHint={isCounselor}
        />

        {/* 2. 서사 섹션 (LLM 또는 규칙 폴백) */}
        {displayNarrative && <NarrativeSections narrative={displayNarrative} />}

        {/* 3. 상담 본문 */}
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

        {isCounselor && markers.length > 0 && (
          <SummaryCard title="주요 지표">
            <div className="space-y-2">
              {markers.map((m, i) => (
                <MarkerBadge key={i} label={m.label} value={m.value} />
              ))}
            </div>
          </SummaryCard>
        )}

        {/* 4. EEG 보조 — 기본 접힘, 토글로 7지표/타임라인 확인 (SDD-056) */}
        {adapted.showEegSection && eeg && (
          <details
            className="group rounded-2xl border border-[#E8D9F5] bg-[#FDFAFF] open:bg-white"
            data-testid="eeg-section"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 md:px-6 [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold text-[#5F0080]">
                  뇌파 상세 지표 보기
                </span>
                {eegQualitySummaryLabel(eeg.status) && (
                  <span className="rounded-lg border border-[#E8D9F5] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#6D547A]">
                    {eegQualitySummaryLabel(eeg.status)}
                  </span>
                )}
              </div>
              <span
                aria-hidden="true"
                className="shrink-0 text-[12px] text-[#9B9B9B] transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <div className="space-y-4 border-t border-[#E8D9F5] px-5 pb-5 pt-4 md:px-6 md:pb-6">
              <EegQualityBanner eeg={eeg} reportType={report.type} />

              {adapted.showEegMetrics && (
                <EegMetricsGrid eeg={eeg} reportType={report.type} compact />
              )}

              {adapted.showEegTimeline && (
                <EegTimeline data={adapted.eeg_timeline} dense={!isCounselor} />
              )}
            </div>
          </details>
        )}

        {/* 액션 */}
        <div className="flex items-center gap-3 pt-4 border-t border-[#EFEFEF]">
          <button
            onClick={() => navigate('/reports')}
            className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
          >
            목록으로
          </button>

          {showApprove && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="mb-btn mb-btn-primary text-[14px] px-6 py-2.5 rounded-xl disabled:opacity-50"
            >
              {approving ? '승인 중...' : '승인 및 발송'}
            </button>
          )}

          {report.pdf_url ? (
            <a
              href={report.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
            >
              PDF 다운로드
            </a>
          ) : report.sent_at ? (
            <button
              onClick={handleGeneratePDF}
              className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
            >
              PDF 생성
            </button>
          ) : null}
        </div>

        {/* SDD-050 — 메일 재발송 (상담사 + client 리포트) */}
        {showResendEmail && (
          <section className="rounded-2xl border border-[#E8D9F5] bg-[#FDFAFF] p-5 md:p-6">
            <h3 className="text-[15px] font-bold text-[#5F0080] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-sm bg-[#5F0080]" />
              리포트 메일 재발송
            </h3>
            <p className="mt-1.5 text-[13px] text-[#6D547A]">
              기본 주소는 저장된 리포트 수신 메일입니다. 수정 후 재발송할 수 있습니다.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={resendEmail}
                onChange={(e) => {
                  setResendEmail(e.target.value);
                  setResendSuccess(null);
                  setResendError(null);
                }}
                placeholder="수신 이메일 주소"
                disabled={resending}
                className="flex-1 px-3.5 py-2.5 border border-[#DDDEE7] rounded-xl bg-white text-[#1F1F1F] text-sm placeholder:text-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15 focus:border-[#5F0080] disabled:opacity-50"
                aria-label="재발송 이메일"
              />
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={resending || !resendEmail.trim()}
                className="mb-btn mb-btn-primary text-[14px] px-6 py-2.5 rounded-xl disabled:opacity-50 shrink-0"
              >
                {resending ? '발송 중...' : '재발송'}
              </button>
            </div>
            {resendSuccess && (
              <div role="status" className="mt-3 p-3 rounded-xl bg-[#F0F9F5] text-[#26724B] text-sm border border-[#D8EFE3]">
                {resendSuccess}
              </div>
            )}
            {resendError && (
              <div role="alert" className="mt-3 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
                {resendError}
              </div>
            )}
          </section>
        )}

        {!isCounselor && (
          <p className="text-center text-[11px] text-[#9B9B9B] pb-4">
            본 리포트는 의료 진단이 아닌 두뇌건강 관리 목적의 참고 자료입니다.
          </p>
        )}
      </div>
    </AppShell>
  );
}
