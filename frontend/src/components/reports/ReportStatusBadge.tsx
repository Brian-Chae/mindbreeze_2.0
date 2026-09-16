// SDD-060 — 리포트 파이프라인 상태 배지 (status 머신 4단계)
// mindbreeze 라이트 토큰 (보라 테마 유지, 배지 색은 상태별)

import {
  REPORT_STATUS_LABELS,
  resolveReportStatus,
  type DataCredibilityDisplay,
  type ReportPipelineStatus,
} from '../../lib/api/report-status';

interface ReportStatusChipProps {
  status?: string | null;
  sentAt?: string | null;
  className?: string;
}

interface ReportStatusBadgeProps {
  status: ReportPipelineStatus;
  credibility: DataCredibilityDisplay | null;
  /** pending_review = 승인 게이트 안내 노출 */
  showApprovalHint?: boolean;
}

/** 칩(목록)용 톤 — 회색/노랑/초록/빨강 */
function chipTone(status: ReportPipelineStatus): string {
  switch (status) {
    case 'pending_analysis':
      return 'bg-[#F1F5F9] text-[#64748B]';
    case 'pending_review':
      return 'bg-[#FEF3C7] text-[#92400E]';
    case 'completed':
      return 'bg-[#E6F4EA] text-[#2E7D32]';
    case 'error':
      return 'bg-red-50 text-red-700';
  }
}

function chipDotClass(status: ReportPipelineStatus): string {
  switch (status) {
    case 'pending_analysis':
      return 'bg-[#94A3B8]';
    case 'pending_review':
      return 'bg-[#F59E0B]';
    case 'completed':
      return 'bg-[#2E7D32]';
    case 'error':
      return 'bg-red-500';
  }
}

/** 상세 패널용 톤 */
function panelTone(status: ReportPipelineStatus): string {
  switch (status) {
    case 'pending_analysis':
      return 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]';
    case 'pending_review':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'completed':
      return 'border-[#D8EFE3] bg-[#F0F9F5] text-[#26724B]';
    case 'error':
      return 'border-red-200 bg-red-50 text-red-700';
  }
}

function statusHint(status: ReportPipelineStatus, showApprovalHint: boolean): string | null {
  if (status === 'pending_review' && showApprovalHint) {
    return '상담사 승인 대기 중입니다. 검수 후 승인하고 메일 발송을 진행해 주세요.';
  }
  if (status === 'pending_analysis') {
    return 'AI 분석이 진행 중입니다. 완료되면 검수 단계로 이동합니다.';
  }
  if (status === 'error') {
    return '리포트 생성 중 오류가 발생했습니다. 재생성 또는 지원팀에 문의하세요.';
  }
  return null;
}

function StatusDot({ status }: { status: ReportPipelineStatus }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${chipDotClass(status)}`}
    />
  );
}

/** 목록용 컴팩트 배지 — status 우선, 없으면 sent_at 폴백 */
export function ReportStatusChip({ status, sentAt, className = '' }: ReportStatusChipProps) {
  const resolved = resolveReportStatus({ status, sent_at: sentAt });
  const label = REPORT_STATUS_LABELS[resolved];

  return (
    <span
      data-testid="report-status-chip"
      data-status={resolved}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${chipTone(resolved)} ${className}`.trim()}
    >
      <StatusDot status={resolved} />
      {label}
    </span>
  );
}

/** 상세 페이지용 패널 배지 */
export default function ReportStatusBadge({
  status,
  credibility,
  showApprovalHint = false,
}: ReportStatusBadgeProps) {
  const label = REPORT_STATUS_LABELS[status];
  const hint = statusHint(status, showApprovalHint);

  return (
    <section
      role="status"
      data-testid="report-pipeline-status"
      data-status={status}
      className={`rounded-xl border px-4 py-3 ${panelTone(status)}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-black/5 bg-white/80 px-2.5 py-1 text-[11px] font-bold tracking-wide">
              <StatusDot status={status} />
              {label}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-60">
              {status}
            </span>
          </div>
          {hint && (
            <p className="mt-2 text-[12px] leading-relaxed opacity-90">{hint}</p>
          )}
        </div>

        {credibility && (
          <div
            data-testid="report-data-credibility"
            className="shrink-0 rounded-lg border border-black/5 bg-white/80 px-3 py-2 text-right"
          >
            <div className="font-mono text-[10px] uppercase tracking-wider opacity-50">
              data_credibility
            </div>
            <div className="mt-0.5 text-[12px] font-semibold">{credibility.label}</div>
          </div>
        )}
      </div>
    </section>
  );
}
