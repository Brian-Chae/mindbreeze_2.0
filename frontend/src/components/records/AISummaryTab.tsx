// AI 요약 탭 — 구조화된 요약 결과를 섹션별 카드로 표시

interface AISummaryData {
  headline?: string;
  sections?: Record<string, string>;
  keywords?: string[];
  risk_flags?: string[];
}

interface Props {
  aiSummary: Record<string, unknown>;
}

export function AISummaryTab({ aiSummary }: Props) {
  const summary = aiSummary as AISummaryData;
  const sections = summary.sections ?? {};
  const keywords = summary.keywords ?? [];
  const riskFlags = summary.risk_flags ?? [];

  return (
    <div className="space-y-4">
      {summary.headline && (
        <h3 className="font-bold tracking-tight text-[#1F1F1F] text-lg">
          {summary.headline}
        </h3>
      )}

      <div className="grid gap-3">
        {Object.entries(sections).map(([title, body]) => (
          <div
            key={title}
            className="rounded-2xl border border-[#DDDEE7] bg-[#F5EDFC] p-4"
          >
            <h4 className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
              {title}
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-[#1F1F1F]">
              {body}
            </p>
          </div>
        ))}
      </div>

      {keywords.length > 0 && (
        <div>
          <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">
            키워드
          </div>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((kw) => (
              <span
                key={kw}
                className="rounded-full bg-[#F5EDFC] px-2.5 py-0.5 text-xs font-medium text-[#5F0080]"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {riskFlags.length > 0 && (
        <div className="rounded-2xl border border-[#F5C2C2] bg-[#FDECEC] p-4">
          <h4 className="text-sm font-semibold text-[#B3261E]">위험 플래그</h4>
          <ul className="mt-2 list-inside list-disc text-sm text-[#B3261E]">
            {riskFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {!summary.headline && Object.keys(sections).length === 0 && (
        <p className="text-sm text-[#6F6F6F]">아직 AI 요약이 생성되지 않았습니다.</p>
      )}
    </div>
  );
}
