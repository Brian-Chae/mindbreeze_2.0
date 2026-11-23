// SDD-329 D — 본인 측정이 없는 회원의 그룹 기록 서사(집계만). 그래프 없으면(n<10) 서사만 보여 준다.
import type { GroupStoryChartV2, GroupStoryV2 as GroupStory } from '../../lib/member-report/types-v2';

const W = 620;
const H = 180;
const PAD = { l: 44, r: 12, t: 12, b: 24 };

function GroupLine({ chart }: { chart: GroupStoryChartV2 }) {
  const n = chart.minutes.length;
  const span = Math.max(chart.axis_max - chart.axis_min, 1e-9);
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - chart.axis_min) / span) * (H - PAD.t - PAD.b);
  const segs: string[] = [];
  let cur = '';
  chart.values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (cur) segs.push(cur);
      cur = '';
    } else {
      cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    }
  });
  if (cur) segs.push(cur);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title} className="mr2-chart">
      <text x={PAD.l - 6} y={PAD.t + 4} textAnchor="end" fontSize="10">{Math.round(chart.axis_max * 10) / 10}</text>
      <text x={PAD.l - 6} y={H - PAD.b} textAnchor="end" fontSize="10">{Math.round(chart.axis_min * 10) / 10}</text>
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="#cbd5e1" />
      {segs.map((d) => <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="2" />)}
    </svg>
  );
}

export default function GroupStoryV2({ story }: { story: GroupStory }) {
  return (
    <section className="mr2-section" id="mr2-group-story" data-testid="mr2-group-story">
      <div className="mr2-eyebrow">{story.label}</div>
      <h2 className="mr2-h2">{story.title}</h2>
      {story.paragraphs.map((p) => <p key={p} className="mr2-body">{p}</p>)}
      {story.charts.map((c) => (
        <div key={c.key} className="mr2-plot">
          <div className="mr2-plot-head"><b>{c.title}</b><span>{c.unit_label}</span></div>
          <GroupLine chart={c} />
        </div>
      ))}
      {story.chart_note && <p className="mr2-footnote">{story.chart_note}</p>}
    </section>
  );
}
