// 리포트 상세 본문 — 페이지/모달 공용 (SDD-064)
// Cover → 서사 → 상담 본문 → EEG → 액션 → 재발송(client only)

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadReportPdf } from '../../lib/report/print-report';
import CounselorCommentCard from './CounselorCommentCard';
import DataExportButton from './DataExportButton';
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

// SDD-087 — content.counselor_comment 파싱 (문자열만 인정, 빈 값은 null)
function commentOf(content: Record<string, unknown> | null | undefined): string | null {
  const value = content?.counselor_comment;
  return typeof value === 'string' && value.trim() ? value : null;
}

// SDD-087 — counselor 리포트에 파생 주입되는 content.client_comments 파싱
interface ClientCommentEntry {
  participant_id: string | null;
  participant_name: string | null;
  comment: string;
}

function parseClientComments(
  content: Record<string, unknown> | null | undefined,
): ClientCommentEntry[] {
  const raw = content?.client_comments;
  if (!Array.isArray(raw)) return [];
  const entries: ClientCommentEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.comment !== 'string' || !rec.comment.trim()) continue;
    entries.push({
      participant_id: typeof rec.participant_id === 'string' ? rec.participant_id : null,
      participant_name: typeof rec.participant_name === 'string' ? rec.participant_name : null,
      comment: rec.comment,
    });
  }
  return entries;
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="report-summary-card bg-white border border-[#EFEFEF] rounded-2xl p-6">
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
  actionContainer?: HTMLElement | null;
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
  actionContainer,
  onReportChange,
  error: externalError = null,
  listActionLabel = '목록으로',
  onListAction,
  showListAction = true,
}: ReportDetailViewProps) {
  const [printing, setPrinting] = useState(false);
  const userRole = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
  const isCounselorUser = userRole === 'counselor';
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [resendEmail, setResendEmail] = useState(initialReport.report_email ?? '');
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  // SDD-087 — 코멘트 카드 미저장 변경 여부 (승인 confirm 소프트 가드)
  const [commentDirty, setCommentDirty] = useState(false);

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
    // SDD-087 — 소프트 가드(백엔드 차단 없음): 미저장 코멘트 / 전달 콘텐츠 없는 승인 확인
    if (
      commentDirty &&
      !window.confirm('저장하지 않은 코멘트가 있습니다. 저장하지 않고 승인할까요?')
    ) {
      return;
    }
    const adaptedNow = adaptReportContent(report.content, report.type);
    const noData = !adaptedNow.eeg && adaptedNow.aiRecord?.status === 'not_available';
    if (
      report.type === 'client' &&
      noData &&
      !commentOf(report.content) &&
      !window.confirm('이 리포트에는 전달할 내용이 없습니다. 코멘트 없이 승인하시겠습니까?')
    ) {
      return;
    }
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
  }, [report, updateReport, commentDirty]);

  const handleGeneratePDF = useCallback(async () => {
    if (printing) return;
    setPrinting(true);
    setError(null);
    try {
      await downloadReportPdf({ reportId: report.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 다운로드에 실패했습니다.');
    } finally {
      setPrinting(false);
    }
  }, [printing, report.id]);

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
      setResendSuccess(`${email}로 리포트 메일을 발송했습니다.`);
    } catch (e) {
      setResendError(e instanceof Error ? e.message : '메일 발송에 실패했습니다.');
    } finally {
      setResending(false);
    }
  }, [report.id, resendEmail]);

  const adapted = adaptReportContent(report.content, report.type);
  const { summary, insights, markers, displayNarrative } = adapted;
  // SDD-085: 마이크 오프(수동 기록) 세션 — AI 요약 섹션 숨김 + 사유 표기
  const aiRecordUnavailable = adapted.aiRecord?.status === 'not_available';
  const aiRecordReasonText =
    adapted.aiRecord?.reason === 'mic_off'
      ? '이 세션은 마이크를 사용하지 않아 AI 자동 기록(전사·요약)이 제공되지 않습니다.'
      : '이 세션에는 AI 자동 기록(전사·요약)이 없습니다.';
  const isCounselor = report.type === 'counselor';
  const eeg = adapted.eeg;
  const eegQualityLabel = eeg ? eegQualitySummaryLabel(eeg.status) : null;
  const pipelineStatus = resolveReportStatus(report);
  const credibility = resolveDataCredibility(
    report.data_credibility,
    eeg?.status ?? null,
  );
  // SDD-087 — 상담사 코멘트
  const counselorComment = commentOf(report.content);
  const clientComments = isCounselor ? parseClientComments(report.content) : [];
  // 측정 데이터 없음 = EEG 미측정(not_measured) + AI 기록 없음(not_available)
  const noMeasuredData = !adapted.eeg && adapted.aiRecord?.status === 'not_available';
  const showCommentEditor =
    isCounselorUser && report.type === 'client' && pipelineStatus === 'pending_review';
  const showApprove = isCounselorUser && canApproveReport({
    status: report.status,
    sent_at: report.sent_at,
    alreadyApprovedLocally: approved,
  });
  // 승인 완료 후 상담사가 수신 주소를 확인하고 별도로 발송한다.
  const showResendEmail = isCounselorUser && report.status === 'completed';
  const displayError = externalError || error;

  const actions = (
      <div data-print-exclude className="flex flex-wrap items-center justify-end gap-3">
        {!actionContainer && showListAction && onListAction && (
          <button
            type="button"
            onClick={onListAction}
            className="border border-[#E8D9F5] bg-white text-[#5F0080] font-medium hover:bg-[#F5EDFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F0080] text-[14px] px-5 py-2.5 rounded-xl"
          >
            {listActionLabel}
          </button>
        )}

        {showApprove && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={approving}
            className="bg-[#5F0080] text-white font-medium hover:bg-[#4A0066] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F0080] text-[14px] px-6 py-2.5 rounded-xl disabled:opacity-50"
          >
            {approving ? '승인 중...' : '승인하기'}
          </button>
        )}

        {(isCounselorUser || userRole === 'platform_admin') && userId && report.participant_id && (
          <DataExportButton key={`${report.session_id}:${report.participant_id}:${userId}`}
            sessionId={report.session_id} participantId={report.participant_id} userId={userId} />
        )}

        {isCounselorUser && report.status === 'completed' && (
          <button
            type="button"
            onClick={handleGeneratePDF}
            disabled={printing}
            aria-busy={printing}
            className="border border-[#E8D9F5] bg-white text-[#5F0080] font-medium hover:bg-[#F5EDFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F0080] text-[14px] px-5 py-2.5 rounded-xl disabled:opacity-50"
          >
            {printing ? 'PDF 준비 중...' : 'PDF 다운로드'}
          </button>
        )}
      </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 print:max-w-none print:[&_.report-main]:overflow-visible print:[&_.narrative-report_section]:break-inside-auto print:[&_.metric]:break-inside-avoid">
      {displayError && (
        <div data-print-exclude role="alert" className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{displayError}</div>
      )}

      <ReportCoverSection report={report} adapted={adapted} />

      <div data-print-exclude><ReportStatusBadge
        status={pipelineStatus}
        credibility={credibility}
        showApprovalHint={isCounselor}
      /></div>

      {/* SDD-087 — 코멘트 작성 카드 (pending_review · client · 상담사) */}
      {showCommentEditor && (
        <CounselorCommentCard
          report={report}
          onReportChange={updateReport}
          showNoDataBanner={noMeasuredData}
          onDirtyChange={setCommentDirty}
        />
      )}

      {/* SDD-087 — counselor 리포트: 내담자별로 보낸 코멘트 파생 표시 */}
      {isCounselor && clientComments.length > 0 && (
        <SummaryCard title="내담자에게 보낸 코멘트">
          <div className="space-y-3">
            {clientComments.map((entry, i) => (
              <div
                key={entry.participant_id ?? i}
                className="bg-[#F5EDFC] rounded-xl p-4"
              >
                {entry.participant_name && (
                  <div className="text-[12px] font-medium text-[#5F0080] mb-1.5">
                    {entry.participant_name}
                  </div>
                )}
                <p className="text-[14px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
                  {entry.comment}
                </p>
              </div>
            ))}
          </div>
        </SummaryCard>
      )}

      {displayNarrative && <NarrativeSections narrative={displayNarrative} />}

      {aiRecordUnavailable && (
        <div className="rounded-2xl border border-[#EFEFEF] bg-[#F9F9F9] p-5 text-sm text-[#6F6F6F]">
          {aiRecordReasonText}
        </div>
      )}

      {!aiRecordUnavailable && summary && (
        <SummaryCard title="AI 요약">
          <p className="text-[15px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
            {summary}
          </p>
        </SummaryCard>
      )}

      {/* SDD-087 — 저장된 상담사 코멘트 (편집 카드 미노출 시 읽기 전용: 내담자 뷰 · completed) */}
      {report.type === 'client' && counselorComment && !showCommentEditor && (
        <SummaryCard title="상담사 코멘트">
          <p className="text-[15px] text-[#1F1F1F] leading-relaxed whitespace-pre-wrap">
            {counselorComment}
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
          data-print-exclude
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

      {actionContainer ? createPortal(actions, actionContainer) : actions}

      {showResendEmail && (
        <section data-print-exclude className="rounded-2xl border border-[#E8D9F5] bg-[#FDFAFF] p-5 md:p-6">
          <h3 className="text-[15px] font-bold text-[#5F0080] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-sm bg-[#5F0080]" />
            메일 발송
          </h3>
          <p className="mt-1.5 text-[13px] text-[#6D547A]">
            기본 주소는 저장된 리포트 수신 메일입니다. 주소를 확인하거나 수정한 후 발송해 주세요.
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
              aria-label="발송 이메일"
            />
            <button
              type="button"
              onClick={handleResendEmail}
              disabled={resending || !resendEmail.trim()}
              className="bg-[#5F0080] text-white font-medium hover:bg-[#4A0066] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F0080] text-[14px] px-6 py-2.5 rounded-xl disabled:opacity-50 shrink-0"
            >
              {resending ? '발송 중...' : '발송'}
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
