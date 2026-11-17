// 그룹 분포 곡선 + 나의 매분 값 막대 (통계로 보기)
import type { Distribution } from '../../lib/member-report/types';
import { scaleLinear, type ChartBox } from './format';

const BOX: ChartBox = { w: 640, h: 150, l: 16, r: 16, t: 14, b: 26 };

export default function DistributionChart({ dist, title }: { dist: Distribution; title: string }) {
  const ticks = dist.axis_ticks;
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (v: number): number => scaleLinear(v, lo, hi, BOX.l, BOX.w - BOX.r);
  const baseY = BOX.h - BOX.b;
  const maxD = Math.max(...dist.density, 1e-9);
  const maxB = Math.max(...dist.my_bars, 1e-9);
  const dens = dist.density;
  const curve = dens.map((d, i) => {
    const xv = BOX.l + (i / Math.max(dens.length - 1, 1)) * (BOX.w - BOX.l - BOX.r);
    return `${xv.toFixed(1)},${scaleLinear(d, 0, maxD, baseY, BOX.t).toFixed(1)}`;
  });
  const barW = (BOX.w - BOX.l - BOX.r) / Math.max(dist.my_bars.length, 1);
  return (
    <svg className="mr-chart" viewBox={`0 0 ${BOX.w} ${BOX.h}`} role="img" aria-label={`${title} 분포 그래프`}>
      <rect
        x={x(dist.mean_group - dist.sd_group)} y={BOX.t}
        width={Math.max(x(dist.mean_group + dist.sd_group) - x(dist.mean_group - dist.sd_group), 0)}
        height={baseY - BOX.t} className="mr-sd-band"
      />
      {dist.my_bars.map((b, i) => {
        const h = scaleLinear(b, 0, maxB, 0, (baseY - BOX.t) * 0.8);
        return <rect key={i} x={BOX.l + i * barW + 2} y={baseY - h} width={Math.max(barW - 4, 1)} height={h} className="mr-bar" />;
      })}
      <path d={`M${curve.join('L')}`} className="mr-density" />
      <line x1={x(dist.mean_group)} x2={x(dist.mean_group)} y1={BOX.t} y2={baseY} className="mr-mean-group" />
      <line x1={x(dist.mean_me)} x2={x(dist.mean_me)} y1={BOX.t} y2={baseY} className="mr-mean-me" />
      <line x1={BOX.l} x2={BOX.w - BOX.r} y1={baseY} y2={baseY} className="mr-grid" />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={BOX.h - 8} textAnchor="middle" className="mr-axis-text">{t}</text>
      ))}
    </svg>
  );
}
