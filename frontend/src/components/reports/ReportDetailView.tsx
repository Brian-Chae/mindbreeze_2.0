// 리포트 상세 본문 — 페이지/모달 공용 (SDD-064)
// Cover → 서사 → 상담 본문 → EEG → 액션 → 재발송(client only)

import { useCallback, useEffect, useState } from 'react';
import EegQualityBanner from './EegQualityBanner';
import EegMetricsGrid from './EegMetricsGrid';
import EegTimeline from './EegTimeline';
import NarrativeSections from './NarrativeSections';
import ReportCoverSection from './ReportCoverSection';
import ReportStatusBadge from './ReportStatusBadge';
import { useAuthStore } from '../../stores/authStore';
import {
  approveReport,
  resendReportEmail,
  adaptReportContent,
  canApproveReport,
  getReport,
  resolveDataCredibility,
  resolveReportStatus,
  type ReportDto,
} from '../../lib/api/reports';
import type { EegQualityStatus } from '../../lib/api/report';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export interface ReportDetailViewProps {
  report: ReportDto;
  /** 승인 등으로 리포트가 갱신될 때 */
  onReportChange?: (report: ReportDto) => void;
  /** 외부 오류 메시지 (로드 실패 등) */
  error?: string | null;
  /** 목록으로 / 닫기 등 보조 액션 */
  listActionLabel?: string;
  onListAction?: () => void;
  showListAction?: boolean;
}

export default function ReportDetailView({
  report: initialReport,
  onReportChange,
  error: externalError = null,
  listActionLabel = '목록으로',
  onListAction,
  showListAction = true,
}: ReportDetailViewProps) {
  const userRole = useAuthStore((s) => s.user?.role);
  const isCounselorUser = userRole === 'counselor';
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [resendEmail, setResendEmail] = useState(initialReport.report_email ?? '');
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    setReport(initialReport);
    setResendEmail(initialReport.report_email ?? '');
    setApproved(false);
    setError(null);
    setResendSuccess(null);
    setResendError(null);
  }, [initialReport]);

  const updateReport = useCallback(
    (next: ReportDto) => {
      setReport(next);
      onReportChange?.(next);
    },
    [onReportChange],
  );

  const handleApprove = useCallback(async () => {
    setApproving(true);
    setError(null);
    try {
      await approveReport(report.id);
      setApproved(true);
      const updated = await getReport(report.id);
      updateReport(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '승인 처리 실패');
    } finally {
      setApproving(false);
    }
  }, [report.id, updateReport]);

  const handleGeneratePDF = useCallback(() => {
    alert('PDF 생성 기능은 추후 제공됩니다.');
  }, []);

  const handleResendEmail = useCallback(async () => {
    const email = resendEmail.trim();
    setResendSuccess(null);
    setResendError(null);
    if (!email || !EMAIL_RE.test(email)) {
      setResendError('올바른 이메일 주소를 입력해 주세요.');
      return;
    }
    setResending(true);
    try {
      await resendReportEmail(report.id, email);
      setResendSuccess(`${email}로 리포트 메일을 재발송했습니다.`);
    } catch (e) {
      setResendError(e instanceof Error ? e.message : '메일 재발송에 실패했습니다.');
    } finally {
      setResending(false);
    }
  }, [report.id, resendEmail]);

  const adapted = adaptReportContent(report.content, report.type);
  const { summary, insights, markers, displayNarrative } = adapted;
  const isCounselor = report.type === 'counselor';
  const eeg = adapted.eeg;
  const eegQualityLabel = eeg ? eegQualitySummaryLabel(eeg.status) : null;
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
  // 상담사라면 리포트 타입(client/counselor) 구분 없이 재발송 가능 (개별 리포트를 원하는 메일로 발송)
  const showResendEmail = isCounselorUser;
  const displayError = externalError || error;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {displayError && (
        <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{displayError}</div>
      )}

      <ReportCoverSection report={report} adapted={adapted} />

      <ReportStatusBadge
        status={pipelineStatus}
        credibility={credibility}
        showApprovalHint={isCounselor}
      />

      {displayNarrative && <NarrativeSections narrative={displayNarrative} />}

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
              {eegQualityLabel && (
                <span className="rounded-lg border border-[#E8D9F5] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#6D547A]">
                  {eegQualityLabel}
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

      <div className="flex items-center gap-3 pt-4 border-t border-[#EFEFEF]">
        {showListAction && onListAction && (
          <button
            type="button"
            onClick={onListAction}
            className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
          >
            {listActionLabel}
          </button>
        )}

        {showApprove && (
          <button
            type="button"
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
            type="button"
            onClick={handleGeneratePDF}
            className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
          >
            PDF 생성
          </button>
        ) : null}
      </div>

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
  );
}
