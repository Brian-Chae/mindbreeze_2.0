// SDD-328 F1 — v2 차트: 시간 그래프(안착 회색·평균±SD 띠·평균 점선) / 분포(막대+KDE+평균선)
import type { DistributionV2, SeriesV2 } from '../../lib/member-report/types-v2';
import { scaleLinear, splitRuns, splitRunsPair, type ChartBox } from '../member-report/format';

const WIDE: ChartBox = { w: 640, h: 220, l: 43, r: 10, t: 14, b: 28 };
const NARROW: ChartBox = { w: 330, h: 220, l: 43, r: 10, t: 14, b: 28 };

function linePath(xs: number[], vals: (number | null)[], y: (v: number) => number): string {
  return splitRuns(vals).map(({ start, end }) => {
    const pts: string[] = [];
    for (let i = start; i <= end; i += 1) pts.push(`${xs[i].toFixed(1)},${y(vals[i] as number).toFixed(1)}`);
    return `M${pts.join('L')}`;
  }).join('');
}

function bandPath(xs: number[], lo: (number | null)[], hi: (number | null)[], y: (v: number) => number): string {
  return splitRunsPair(lo, hi).map(({ start, end }) => {
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = start; i <= end; i += 1) {
      top.push(`${xs[i].toFixed(1)},${y(hi[i] as number).toFixed(1)}`);
      bottom.unshift(`${xs[i].toFixed(1)},${y(lo[i] as number).toFixed(1)}`);
    }
    return `M${top.join('L')}L${bottom.join('L')}Z`;
  }).join('');
}

function tickText(v: number, span: number): string {
  const d = span < 1 ? 3 : span < 10 ? 1 : span < 100 ? 1 : 0;
  return v.toFixed(d);
}

interface TimeProps { series: SeriesV2; title: string; narrow?: boolean; settleMinutes: number }

export function TimeChartV2({ series, title, narrow = false, settleMinutes }: TimeProps) {
  const box = narrow ? NARROW : WIDE;
  const mins = series.minutes;
  const useNorm = series.values === null;
  const mine = (useNorm ? series.norm : series.values) ?? [];
  const x0 = mins[0] ?? 1;
  const x1 = mins[mins.length - 1] ?? x0 + 1;
  const xAt = (m: number): number => scaleLinear(m, x0 - 0.5, x1 + 0.5, box.l, box.w - box.r);
  const xs = mins.map(xAt);
  const d0 = useNorm ? 0 : (series.axis_min ?? 0);
  const d1 = useNorm ? 1 : (series.axis_max ?? 1);
  const baseY = box.h - box.b;
  const clampY = (v: number): number => Math.min(baseY, Math.max(box.t, scaleLinear(v, d0, d1, baseY, box.t)));
  const band = series.group_band;
  const lo = band ? band.mean.map((m, i) => (m === null || band.sd[i] === null ? null : m - (band.sd[i] as number))) : [];
  const hi = band ? band.mean.map((m, i) => (m === null || band.sd[i] === null ? null : m + (band.sd[i] as number))) : [];
  const ticks = useNorm ? [] : [d0, (d0 + d1) / 2, d1];
  const xTicks = mins.filter((m) => m === x0 || m % 10 === 0 || m === x1);
  const shadeEnd = xAt(x0 - 0.5 + settleMinutes);
  return (
    <svg className="mr2-chart" viewBox={`0 0 ${box.w} ${box.h}`} role="img" aria-label={`${title} 시간 그래프`}>
      {series.settle_shade && (
        <rect className="mr2-settle" x={box.l} y={box.t} width={Math.max(shadeEnd - box.l, 0)} height={baseY - box.t} />
      )}
      {ticks.map((t) => (
        <g key={t}>
          <path className="mr2-grid" d={`M${box.l},${clampY(t).toFixed(1)}H${box.w - box.r}`} />
          <text className="mr2-axis" x={box.l - 5} y={clampY(t) + 4} textAnchor="end">{tickText(t, d1 - d0)}</text>
        </g>
      ))}
      {useNorm && <path className="mr2-grid" d={`M${box.l},${baseY}H${box.w - box.r}`} />}
      {band && <path className="mr2-band" d={bandPath(xs, lo, hi, clampY)} />}
      {band && <path className="mr2-gmean" d={linePath(xs, band.mean, clampY)} />}
      <path className="mr2-line" d={linePath(xs, mine, clampY)} />
      {xTicks.map((m) => (
        <text key={m} className="mr2-axis" x={xAt(m)} y={box.h - 8} textAnchor="middle">{m}분</text>
      ))}
    </svg>
  );
}

const DBOX: ChartBox = { w: 330, h: 170, l: 20, r: 10, t: 18, b: 30 };

export function DistributionChartV2({ dist, title, unit }: { dist: DistributionV2; title: string; unit: string }) {
  const { lo, hi } = dist;
  const x = (v: number): number => scaleLinear(v, lo, hi, DBOX.l, DBOX.w - DBOX.r);
  const baseY = DBOX.h - DBOX.b;
  const plotH = baseY - DBOX.t;
  const nb = Math.max(dist.my_bars.length, 1);
  const barW = (DBOX.w - DBOX.l - DBOX.r) / nb;
  const curve = dist.density.map((d, i) => {
    const xv = DBOX.l + (i / Math.max(dist.density.length - 1, 1)) * (DBOX.w - DBOX.l - DBOX.r);
    return `${xv.toFixed(1)},${(baseY - Math.min(Math.max(d, 0), 1) * plotH).toFixed(1)}`;
  });
  const bandL = Math.max(x(dist.mean_group - dist.sd_group), DBOX.l);
  const bandR = Math.min(x(dist.mean_group + dist.sd_group), DBOX.w - DBOX.r);
  const span = hi - lo;
  return (
    <svg className="mr2-chart" viewBox={`0 0 ${DBOX.w} ${DBOX.h}`} role="img" aria-label={`${title} 전체 시간 분포`}>
      <rect className="mr2-sd" x={bandL} y={DBOX.t} width={Math.max(bandR - bandL, 0)} height={plotH} />
      {dist.my_bars.map((b, i) => {
        const h = Math.min(Math.max(b, 0), 1) * plotH;
        return <rect key={i} className="mr2-bar" x={DBOX.l + i * barW + 1} y={baseY - h} width={Math.max(barW - 2, 1)} height={h} />;
      })}
      <path className="mr2-density" d={`M${curve.join('L')}`} />
      <line className="mr2-gmean-v" x1={x(dist.mean_group)} x2={x(dist.mean_group)} y1={DBOX.t} y2={baseY} />
      <line className="mr2-me-v" x1={x(dist.mean_me)} x2={x(dist.mean_me)} y1={DBOX.t} y2={baseY} />
      <path className="mr2-grid" d={`M${DBOX.l},${baseY}H${DBOX.w - DBOX.r}`} />
      {dist.axis_ticks.map((t) => (
        <text key={t} className="mr2-axis" x={x(t)} y={DBOX.h - 12} textAnchor="middle">{tickText(t, span)}</text>
      ))}
      <text className="mr2-axis" x={DBOX.w - DBOX.r} y={DBOX.h - 1} textAnchor="end">{unit}</text>
    </svg>
  );
}
