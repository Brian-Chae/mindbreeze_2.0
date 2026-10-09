// SDD-101 — 리포트 '생성 진행' 상태 배지 (승인 상태와 독립 축)
//
// /reports 목록에서 리포트가 '생성 중인지/실패했는지/완료됐는지'를 보여준다.
//   · status(승인 게이트)가 error 이거나 generation_error 가 있으면 → '생성 실패' + 사유
//   · 그 외에는 generation_status(pending/processing/ready/partial) 라벨을 표시
// '생성 실패'일 때는 generation_error(실제 예외)를 사유로 함께 노출한다.

import {
  REPORT_GENERATION_LABELS,
  resolveReportGenerationStatus,
  type ReportGenerationStatus,
} from '../../lib/api/report-status';

interface GenerationStatusBadgeProps {
  /** 승인 게이트 상태 — 'error' 이면 생성 실패로 간주 */
  status?: string | null;
  /** 생성 진행 상태(pending/processing/ready/partial) */
  generationStatus?: string | null;
  /** 생성 실패 사유(예외 타입·메시지, 50자 이하) */
  generationError?: string | null;
  /** 생성 시작 시각(processing 진입 시각) */
  generationStartedAt?: string | null;
  className?: string;
}

function tone(gen: ReportGenerationStatus, failed: boolean): string {
  if (failed) return 'bg-red-50 text-red-700 border-red-200';
  switch (gen) {
    case 'processing':
      return 'bg-[#EAF2FF] text-[#1D4ED8] border-[#DBEAFE]';
    case 'ready':
      return 'bg-[#E6F4EA] text-[#2E7D32] border-[#D8EFE3]';
    case 'partial':
      return 'bg-[#FEF3C7] text-[#92400E] border-amber-200';
    case 'pending':
    default:
      return 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]';
  }
}

function dot(gen: ReportGenerationStatus, failed: boolean): string {
  if (failed) return 'bg-red-500';
  switch (gen) {
    case 'processing':
      return 'bg-[#3B82F6] animate-pulse';
    case 'ready':
      return 'bg-[#2E7D32]';
    case 'partial':
      return 'bg-[#F59E0B]';
    default:
      return 'bg-[#94A3B8]';
  }
}

function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function GenerationStatusBadge({
  status,
  generationStatus,
  generationError,
  generationStartedAt,
  className = '',
}: GenerationStatusBadgeProps) {
  const failed = status === 'error' || Boolean(generationError);
  const gen = resolveReportGenerationStatus(generationStatus);
  const label = failed ? '생성 실패' : REPORT_GENERATION_LABELS[gen];
  const startedAt = formatTime(generationStartedAt);

  return (
    <div className={`inline-flex flex-col items-start gap-1 ${className}`.trim()}>
      <span
        data-testid="generation-status-badge"
        data-generation-status={failed ? 'error' : gen}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold border ${tone(gen, failed)}`.trim()}
      >
        <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot(gen, failed)}`} />
        {label}
      </span>
      {failed && generationError && (
        <span
          data-testid="generation-error-log"
          className="inline-flex items-center gap-1 text-[12px] text-red-600 font-mono break-all"
          title={generationError}
        >
          {generationError}
        </span>
      )}
      {startedAt && (
        <span className="text-[12px] text-[#9B9B9B] font-mono">시작 {startedAt}</span>
      )}
    </div>
  );
}
