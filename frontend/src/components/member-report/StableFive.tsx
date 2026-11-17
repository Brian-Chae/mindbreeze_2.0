// 안정된 5분 참고 위치 — 척도 3개(심박·RMSSD·SDNN)
import type { ReferenceScale, Stable5 } from '../../lib/member-report/types';
import { fmt, scaleLinear } from './format';

function ScaleSvg({ s }: { s: ReferenceScale }) {
  const W = 360;
  const l = 12;
  const r = W - 12;
  const x = (v: number): number => scaleLinear(Math.min(Math.max(v, s.axis_min), s.axis_max), s.axis_min, s.axis_max, l, r);
  return (
    <svg className="mr-scale-svg" viewBox={`0 0 ${W} 72`} role="img" aria-label={`${s.title} 참고 위치`}>
      <line x1={l} x2={r} y1={38} y2={38} className="mr-scale-axis" />
      <rect x={x(s.band_lo)} y={30} width={Math.max(x(s.band_hi) - x(s.band_lo), 0)} height={16} className="mr-scale-band" />
      <text x={x(s.band_lo)} y={64} textAnchor="middle" className="mr-axis-text">{s.band_lo}</text>
      <text x={x(s.band_hi)} y={64} textAnchor="middle" className="mr-axis-text">{s.band_hi}</text>
      {s.group_median !== null && (
        <path d={`M${x(s.group_median)},26 l-5,-9 h10z`} className="mr-scale-group" />
      )}
      <circle cx={x(s.value)} cy={38} r={7} className="mr-scale-me" />
    </svg>
  );
}

export default function StableFive({ data }: { data: Stable5 }) {
  return (
    <article className="mr-card mr-stable" id="mr-stable5">
      <div className="mr-eyebrow">{data.eyebrow}</div>
      <h3 className="mr-metric-title">{data.title}</h3>
      <p className="mr-body">{data.narrative}</p>
      <div className="mr-scale-grid">
        {data.scales.map((s) => (
          <section key={s.key} className="mr-scale" data-scale={s.key}>
            <div className="mr-scale-head">
              <h4>{s.title}</h4>
              <b className="mr-num">{fmt(s.value, s.decimals)}</b>
              <span className="mr-pill">{s.pill}</span>
            </div>
            <p className="mr-note">{s.range_note}</p>
            <ScaleSvg s={s} />
            <ul className="mr-meaning">
              {s.meaning.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <p className="mr-note">{s.explain}</p>
            <p className="mr-note">{s.note}</p>
          </section>
        ))}
      </div>
      <p className="mr-reading">{data.reading}</p>
      <div className="mr-callout"><b>{data.callout_title}</b> {data.callout_body}</div>
    </article>
  );
}
