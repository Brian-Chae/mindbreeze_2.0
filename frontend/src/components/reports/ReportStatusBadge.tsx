// SDD-027 — 리포트 파이프라인 상태 배지 + data_credibility
// 다크 AI 톤: slate-950 + cyan/amber/emerald/red 얇은 경계

import {
  REPORT_STATUS_LABELS,
  type DataCredibilityDisplay,
  type ReportPipelineStatus,
} from '../../lib/api/report-status';

interface ReportStatusBadgeProps {
  status: ReportPipelineStatus;
  credibility: DataCredibilityDisplay | null;
  /** pending_review = 승인 게이트 안내 노출 */
  showApprovalHint?: boolean;
}

function statusTone(status: ReportPipelineStatus): string {
  switch (status) {
    case 'pending_analysis':
      return 'border-cyan-400/30 bg-cyan-950/40 text-cyan-100';
    case 'pending_review':
      return 'border-amber-400/30 bg-amber-950/40 text-amber-100';
    case 'completed':
      return 'border-emerald-400/30 bg-emerald-950/40 text-emerald-100';
    case 'error':
      return 'border-red-400/30 bg-red-950/50 text-red-100';
  }
}

function statusHint(status: ReportPipelineStatus, showApprovalHint: boolean): string | null {
  if (status === 'pending_review' && showApprovalHint) {
    return '상담사 승인 대기 중입니다. 검수 후 승인하면 내담자에게 발송됩니다.';
  }
  if (status === 'pending_analysis') {
    return 'AI 분석이 진행 중입니다. 완료되면 검수 단계로 이동합니다.';
  }
  if (status === 'error') {
    return '리포트 생성 중 오류가 발생했습니다. 재생성 또는 지원팀에 문의하세요.';
  }
  return null;
}

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
      className={`rounded-xl border px-4 py-3 ${statusTone(status)}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-lg border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] font-bold tracking-wide">
              {label}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">
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
            className="shrink-0 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-right"
          >
            <div className="font-mono text-[10px] uppercase tracking-wider opacity-60">
              data_credibility
            </div>
            <div className="mt-0.5 text-[12px] font-semibold">{credibility.label}</div>
          </div>
        )}
      </div>
    </section>
  );
}
