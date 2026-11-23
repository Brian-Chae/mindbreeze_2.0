// SDD-328 F1 — 지표 쪽: 결론 → 시간 그래프(평균±SD 띠) → 해석 → 통계로 보기(분포) → 읽는 법 → 각주
import type { MetricSectionV2 } from '../../lib/member-report/types-v2';
import { DistributionChartV2, TimeChartV2 } from './charts-v2';

export default function MetricCardV2({ section, settleMinutes }: { section: MetricSectionV2; settleMinutes: number }) {
  const body = section.body;
  if (section.state !== 'ok' || !body) return null; // 결측 지표 쪽은 생략
  const isFlow = body.change?.kind === 'flow' || body.series.values === null;
  return (
    <article className="mr2-card" id={`mr2-${section.key}`} data-metric={section.key}>
      <div className="mr2-eyebrow">{body.eyebrow}</div>
      <h3 className="mr2-metric-title">{body.conclusion}</h3>
      {body.bridge && <p className="mr2-bridge">{body.bridge}</p>}
      <div className="mr2-plot">
        <div className="mr2-plot-head">
          <b>나의 시간 흐름</b>
          {body.comparison_text && <strong className="mr2-num">{body.comparison_text}</strong>}
        </div>
        <div className="mr2-wide"><TimeChartV2 series={body.series} title={section.title} settleMinutes={settleMinutes} /></div>
        <div className="mr2-narrow"><TimeChartV2 series={body.series} title={section.title} settleMinutes={settleMinutes} narrow /></div>
        <p className="mr2-legend">{body.series_legend}</p>
      </div>
      <div className="mr2-interpret"><b>이게 무슨 뜻이에요</b><p>{body.interpret}</p></div>
      {body.group && !isFlow && (
        <div className="mr2-group">
          <h4>{body.group.title}</h4>
          <div className="mr2-dist-grid">
            <div className="mr2-dist"><DistributionChartV2 dist={body.group.distribution} title={section.title} unit={body.series.axis_unit} /></div>
            <div>{body.group.paragraphs.map((p) => <p key={p} className="mr2-body-sm">{p}</p>)}</div>
          </div>
          <p className="mr2-legend">{body.group.legend}</p>
          {body.group.footnote && <p className="mr2-footnote">{body.group.footnote}</p>}
        </div>
      )}
      {body.companion && (
        <div className="mr2-group">
          <h4>{body.companion.title}</h4>
          <p className="mr2-body-sm">{body.companion.body}</p>
        </div>
      )}
      {body.reading && <p className="mr2-reading">이렇게 읽어요 · {body.reading}</p>}
      {body.footnote && <p className="mr2-footnote">{body.footnote}</p>}
    </article>
  );
}
