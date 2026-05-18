// 온보딩 단계 진행 표시 (4단계 기본)

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
    <ol className="flex items-center w-full">
      {steps.map((step, idx) => {
        const state = getState(step, currentStep, completedSteps);
        const isLast = idx === steps.length - 1;

        const circleClass =
          state === 'completed'
            ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
            : state === 'current'
              ? 'bg-[var(--color-surface)] text-[var(--color-primary)] border-[var(--color-primary)]'
              : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)]';

        const lineClass =
          state === 'completed' ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]';

        return (
          <li key={step} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full border-2 font-semibold text-sm transition-colors ${circleClass}`}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {state === 'completed' ? '✓' : step}
              </div>
              {labels && labels[idx] && (
                <span className="mt-2 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                  {labels[idx]}
                </span>
              )}
            </div>
            {!isLast && <div className={`flex-1 h-0.5 mx-2 ${lineClass}`} />}
          </li>
        );
      })}
    </ol>
  );
}
