// AI 요약 탭 — 구조화된 요약 결과를 섹션별 카드로 표시

interface Props {
  aiSummary: Record<string, unknown>;
}

export function AISummaryTab({ aiSummary }: Props) {
  const summary = aiSummary as {
    headline?: string;
    sections?: Record<string, string>;
    keywords?: string[];
    risk_flags?: string[];
  };
  const sections = summary.sections ?? {};
  const keywords = summary.keywords ?? [];
  const riskFlags = summary.risk_flags ?? [];

  return (
    <div className="space-y-4">
      {summary.headline && (
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {summary.headline}
        </h3>
      )}

      <div className="grid gap-3">
        {Object.entries(sections).map(([title, body]) => (
          <div
            key={title}
            className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
          >
            <h4 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {title}
            </h4>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              {body}
            </p>
          </div>
        ))}
      </div>

      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((kw) => (
            <span
              key={kw}
              className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {riskFlags.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
          <h4 className="text-sm font-semibold text-red-700 dark:text-red-400">위험 플래그</h4>
          <ul className="mt-1 list-inside list-disc text-sm text-red-600 dark:text-red-300">
            {riskFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {!summary.headline && Object.keys(sections).length === 0 && (
        <p className="text-sm text-neutral-500">아직 AI 요약이 생성되지 않았습니다.</p>
      )}
    </div>
  );
}
