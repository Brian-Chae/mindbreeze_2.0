// SDD-328 F1 — 가장 편안했던 5분 (단정형 금지: 후보 문구 그대로 표시)
import type { Quiet5 } from '../../lib/member-report/types-v2';

export default function QuietFiveV2({ data }: { data: Quiet5 }) {
  return (
    <article className="mr2-card" id="mr2-quiet5" data-testid="mr2-quiet5">
      <div className="mr2-eyebrow">{data.eyebrow}</div>
      <h3 className="mr2-metric-title">{data.title}</h3>
      <p className="mr2-body-sm">{data.note}</p>
      <div className="mr2-quiet-grid">
        {data.items.map((it) => (
          <div key={it.title} className="mr2-quiet-item">
            <h4>{it.title}</h4>
            <strong className="mr2-num">{it.value_text}</strong>
            <p>{it.body}</p>
            {it.footnote && <p className="mr2-footnote">{it.footnote}</p>}
          </div>
        ))}
      </div>
      <div className="mr2-interpret"><b>{data.reading_title}</b><p>{data.reading_body}</p></div>
    </article>
  );
}
