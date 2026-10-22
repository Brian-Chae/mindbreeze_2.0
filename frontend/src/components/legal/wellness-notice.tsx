import { ESTIMATED_METRICS_NOTICE, WELLNESS_DISCLAIMER } from '../../lib/legal-copy';
export function WellnessNotice() {
  return <aside aria-label="측정 지표 안내" className="my-4 rounded-xl border border-border-default bg-surface-raised p-4 text-sm mobile:text-mb-body text-ink-secondary">
    <p>{ESTIMATED_METRICS_NOTICE}</p><p>{WELLNESS_DISCLAIMER}</p>
    <a href="/measurement-guide" className="mobile:min-h-11 mobile:min-w-11 mobile:inline-flex mobile:items-center text-brand-primary underline">측정 방법과 한계 알아보기</a>
  </aside>;
}
