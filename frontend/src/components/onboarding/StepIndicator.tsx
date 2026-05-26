// 온보딩 단계 진행 표시 (4단계 기본) — 다크 테마

interface StepIndicatorProps {
  currentStep: number;
  completedSteps: number[];
  totalSteps?: number;
  labels?: string[];
}

type StepState = 'completed' | 'current' | 'pending';

const getState = (step: number, currentStep: number, completed: number[]): StepState => {
  if (completed.includes(step)) return 'completed';
  if (step === currentStep) return 'current';
  return 'pending';
};

export function StepIndicator({ currentStep, completedSteps, totalSteps = 4, labels }: StepIndicatorProps) {
  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);

  return (
    <ol className="flex items-start w-full">
      {steps.map((step, idx) => {
        const state = getState(step, currentStep, completedSteps);
        const isLast = idx === steps.length - 1;

        const circleClass =
          state === 'completed'
            ? 'bg-[#5F0080] text-white border-[#5F0080]'
            : state === 'current'
              ? 'bg-white/10 text-white border-white/40'
              : 'bg-white/5 text-white/40 border-white/20';

        const lineClass =
          state === 'completed' ? 'bg-[#5F0080]' : 'bg-white/20';

        return (
          <li key={step} className={`flex items-start ${isLast ? '' : 'flex-1'}`}>
            {/* 원 + 라벨 (중앙 정렬) */}
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`flex items-center justify-center w-9 h-9 rounded-full border-2 font-semibold text-xs transition-colors ${circleClass}`}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {state === 'completed' ? '✓' : step}
              </div>
              {labels && labels[idx] && (
                <span className="mt-1.5 text-[11px] text-white/50 whitespace-nowrap text-center">
                  {labels[idx]}
                </span>
              )}
            </div>
            {/* 연결선 — 원의 중앙 높이에 위치 */}
            {!isLast && <div className={`flex-1 h-0.5 mt-[17px] mx-1 ${lineClass}`} />}
          </li>
        );
      })}
    </ol>
  );
}
