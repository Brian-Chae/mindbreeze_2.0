// SDD-095 — 리포트 생성 진행 스텝퍼 (녹음 저장 → STT → 요약 → 완료)
//
// 세션 종료(리포트 대기) 화면에서 '처리 중'을 명확히 보여준다.
// 완료 시에는 요란한 팝업 대신 은은한 요약 카드(+선택적 기록 보기 버튼)로 축약된다.
// 톤(dark)은 풀스크린 플레이어(어두운 배경), light 는 관리자/기록지 화면용.

import {
  REPORT_GENERATION_LABELS,
  REPORT_PROGRESS_STEP_LABELS,
  isReportGenerationDone,
  reportProgressReasonLabel,
  type ReportProgressDto,
  type ReportStepState,
} from '../../lib/api/reports';

interface ReportProgressStepperProps {
  progress: ReportProgressDto | null;
  tone?: 'light' | 'dark';
  onViewReport?: () => void;
  className?: string;
}

const TONE_CLASSES = {
  light: {
    card: 'bg-white border border-[#DDDEE7]',
    title: 'text-[#1F1F1F]',
    muted: 'text-[#6F6F6F]',
    track: 'bg-[#F2F3F8]',
    fill: 'bg-[#5F0080]',
    done: 'bg-[#5F0080] text-white',
    active: 'bg-[#F5EDFC] text-[#5F0080] ring-2 ring-[#5F0080]',
    pending: 'bg-[#F2F3F8] text-[#6F6F6F]',
    skipped: 'bg-[#F2F3F8] text-[#9B9B9B]',
    failed: 'bg-[#FDECEC] text-[#B3261E]',
    connectorDone: 'bg-[#5F0080]',
    connectorIdle: 'bg-[#DDDEE7]',
    chip: 'bg-[#F5EDFC] text-[#5F0080]',
  },
  dark: {
    card: 'bg-white/5 border border-white/10',
    title: 'text-white',
    muted: 'text-white/60',
    track: 'bg-white/10',
    fill: 'bg-[#C9A6EA]',
    done: 'bg-[#C9A6EA] text-[#2A0A3D]',
    active: 'bg-white/10 text-white ring-2 ring-[#C9A6EA]',
    pending: 'bg-white/10 text-white/50',
    skipped: 'bg-white/10 text-white/40',
    failed: 'bg-[#B3261E]/30 text-white',
    connectorDone: 'bg-[#C9A6EA]',
    connectorIdle: 'bg-white/15',
    chip: 'bg-white/10 text-white/80',
  },
} as const;

/** 스텝 상태 → 원형 마커 글리프 */
function stepGlyph(state: ReportStepState, index: number): string {
  switch (state) {
    case 'done':
      return '✓';
    case 'skipped':
      return '–';
    case 'failed':
      return '!';
    default:
      return String(index + 1);
  }
}

/** 현재 진행 단계 문구 */
function statusCopy(progress: ReportProgressDto): { title: string; body: string } {
  const { generation_status, stage, reason } = progress;
  const stageLabel = REPORT_PROGRESS_STEP_LABELS[stage] ?? '';

  if (generation_status === 'ready') {
    return {
      title: '리포트가 준비되었습니다',
      body: '세션 기록과 AI 리포트를 확인할 수 있어요.',
    };
  }
  if (generation_status === 'partial') {
    return {
      title: '리포트가 일부만 준비되었습니다',
      body: reportProgressReasonLabel(reason) ?? '일부 내용만 담겨 있어요. 전사문은 기록에서 확인할 수 있어요.',
    };
  }
  if (generation_status === 'processing') {
    return {
      title: `${stageLabel} 진행 중…`,
      body: 'AI가 세션을 정리하고 있어요. 화면은 자동으로 갱신됩니다.',
    };
  }
  return {
    title: '리포트 생성을 준비하고 있어요',
    body: '세션이 종료되면 자동으로 시작됩니다.',
  };
}

export function ReportProgressStepper({
  progress,
  tone = 'light',
  onViewReport,
  className = '',
}: ReportProgressStepperProps) {
  if (!progress) return null;

  const c = TONE_CLASSES[tone];
  const done = isReportGenerationDone(progress.generation_status);
  const copy = statusCopy(progress);

  return (
    <div
      className={`rounded-2xl p-5 ${c.card} ${className}`}
      data-testid="report-progress-stepper"
      data-generation-status={progress.generation_status}
      data-progress={progress.progress}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm font-semibold ${c.title}`}>{copy.title}</p>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${c.chip}`}
          data-testid="report-progress-status-chip"
        >
          {REPORT_GENERATION_LABELS[progress.generation_status]}
        </span>
      </div>

      {/* 스텝 바 */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {progress.steps.map((step, i) => {
          const isDone = step.state === 'done';
          const stateClass =
            step.state === 'done'
              ? c.done
              : step.state === 'active'
                ? c.active
                : step.state === 'failed'
                  ? c.failed
                  : step.state === 'skipped'
                    ? c.skipped
                    : c.pending;
          return (
            <div key={step.key} className="flex items-center gap-1.5" data-testid={`report-step-${step.key}`} data-step-state={step.state}>
              {i > 0 && (
                <div
                  className={`h-px w-5 sm:w-8 ${isDone || step.state === 'active' ? c.connectorDone : c.connectorIdle}`}
                  aria-hidden
                />
              )}
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${stateClass}`}>
                {stepGlyph(step.state, i)}
              </div>
              <span className={`text-xs ${step.state === 'active' ? `font-semibold ${c.title}` : c.muted}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* 진행률 바 */}
      <div className={`mt-4 h-1.5 w-full overflow-hidden rounded-full ${c.track}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.progress}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${c.fill}`}
          style={{ width: `${progress.progress}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className={`text-xs ${c.muted}`}>{copy.body}</p>
        {done && onViewReport && (
          <button
            type="button"
            onClick={onViewReport}
            className={tone === 'dark' ? 'mb-btn mb-btn--ghost !py-1.5 !text-xs !text-white/90 hover:!text-white' : 'mb-btn !py-1.5 !text-xs'}
          >
            기록 보기
          </button>
        )}
      </div>
    </div>
  );
}

export default ReportProgressStepper;
