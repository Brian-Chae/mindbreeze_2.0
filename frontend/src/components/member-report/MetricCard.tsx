// 지표 카드: 변화 결론 → 시간 그래프 → 해석 → 그룹 비교(접기)
import type { MemberMeta, MetricSection } from '../../lib/member-report/types';
import { directionArrow, fmt, fmtSigned } from './format';
import TimeChart from './TimeChart';
import DistributionChart from './DistributionChart';

export default function MetricCard({ section, meta }: { section: MetricSection; meta: MemberMeta }) {
  const body = section.body;
  if (section.state !== 'ok' || !body) return null; // 결측 지표 카드는 생략
  const { change } = body;
  const isFlow = section.key === 'lf_hf'; // LF/HF 는 흐름 전용 — 변화량 렌더 금지
  const segLabel = (key: string): string => meta.segments.find((s) => s.key === key)?.label ?? key;
  return (
    <article className="mr-card mr-metric" id={`mr-${section.key}`} data-metric={section.key}>
      <div className="mr-eyebrow">{body.eyebrow}</div>
      <h3 className="mr-metric-title">{body.conclusion}</h3>
      {body.bridge && <p className="mr-bridge">{body.bridge}</p>}
      <div className="mr-plot">
        <div className="mr-plot-head">
          <span>{section.title} · 나의 시간 흐름</span>
          {!isFlow && (
            <span className="mr-delta mr-num" data-testid="mr-delta">
              {fmt(change.before, change.decimals)} → {fmt(change.after, change.decimals)} · {directionArrow(change.direction)}
              {fmt(Math.abs(change.delta), change.decimals)} {change.label}
            </span>
          )}
        </div>
        <TimeChart series={body.series} segments={meta.segments} mySegments={body.my_segments} title={section.title} />
        <p className="mr-legend">{body.series_legend}</p>
      </div>
      <div className="mr-interpret"><b>이게 무슨 뜻이에요</b>{body.interpretation}</div>
      {body.source_note && <p className="mr-note">{body.source_note}</p>}
      {body.group ? (
        <details className="mr-group">
          <summary>{body.group.title}</summary>
          <p className="mr-body-sm">{body.group.explain}</p>
          <DistributionChart dist={body.group.distribution} title={section.title} />
          <p className="mr-legend">{body.group.legend}</p>
          <div className="mr-table-wrap">
            <table className="mr-table">
              <thead><tr><th>구간</th><th>나의 중앙</th><th>그룹 중앙</th><th>차이</th><th>비교한 분</th></tr></thead>
              <tbody>
                {body.group.rows.map((r) => (
                  <tr key={r.segment_key}>
                    <th>{segLabel(r.segment_key)}</th>
                    <td className="mr-num">{fmt(r.mine, change.decimals)}</td>
                    <td className="mr-num">{fmt(r.group, change.decimals)}</td>
                    <td className="mr-num">{fmtSigned(r.diff, change.decimals)}</td>
                    <td className="mr-num">{r.compared_minutes}분</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mr-note">{body.group.table_note}</p>
        </details>
      ) : null}
      {body.reading && <p className="mr-reading">{body.reading}</p>}
      {body.result_note && <p className="mr-callout">{body.result_note}</p>}
    </article>
  );
}
