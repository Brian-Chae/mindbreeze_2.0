import type { AgentCta } from '../../../lib/api/agent';
import { isCtaDisabled } from '../../../lib/agent/actions';

export default function CtaCard({ ctas, busy, onAction }: {
  ctas: AgentCta[];
  busy: boolean;
  onAction: (cta: AgentCta) => void;
}) {
  return <div className="mt-3 flex flex-wrap gap-2">
    {ctas.filter((cta) => cta.action !== 'call_counselor' || cta.payload?.tel?.trim()).map((cta) => (
      <button key={cta.id} type="button" disabled={busy || isCtaDisabled(cta, ctas)}
        onClick={() => onAction(cta)}
        className="rounded-xl border border-[#5F0080]/20 bg-white px-3 py-2 text-sm text-[#5F0080] disabled:opacity-40">
        {cta.label}{cta.done ? ' · 완료' : ''}
      </button>
    ))}
  </div>;
}
