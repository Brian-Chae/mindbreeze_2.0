// 지표 시간 그래프 (SVG) — 전/후 구간 강조, 그룹 띠, 나의 매분 값(결측 분은 선을 끊음)
import type { GroupBand, MetricSeries, Segment, SegmentValue } from '../../lib/member-report/types';
import { scaleLinear, splitRuns, splitRunsPair, type ChartBox } from './format';

const BOX: ChartBox = { w: 640, h: 220, l: 44, r: 14, t: 14, b: 28 };

interface Props {
  series: MetricSeries;
  segments: Segment[];
  mySegments: SegmentValue[];
  title: string;
}

function areaPath(
  xs: number[], lo: (number | null)[], hi: (number | null)[], y: (v: number) => number,
): string {
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

function linePath(xs: number[], vals: (number | null)[], y: (v: number) => number): string {
  return splitRuns(vals).map(({ start, end }) => {
    const pts: string[] = [];
    for (let i = start; i <= end; i += 1) pts.push(`${xs[i].toFixed(1)},${y(vals[i] as number).toFixed(1)}`);
    return `M${pts.join('L')}`;
  }).join('');
}

export default function TimeChart({ series, segments, mySegments, title }: Props) {
  const mins = series.minutes;
  const useNorm = series.values === null;
  const mine = (useNorm ? series.norm : series.values) ?? [];
  const n = mins.length;
  const x0 = mins[0] ?? 0;
  const x1 = mins[n - 1] ?? x0 + 1;
  const xs = mins.map((m) => scaleLinear(m, x0 - 0.5, x1 + 0.5, BOX.l, BOX.w - BOX.r));
  // 흐름 전용(norm) 지표는 절대 척도가 없으므로 내 값의 범위에 맞춰 위아래 10% 여백을 둔다.
  //  0~1 고정 축이면 값이 좁은 범위(예: LF/HF 0.04~0.38)에 몰려 그래프가 바닥에 깔린다.
  const normVals = useNorm ? mine.filter((v): v is number => v !== null) : [];
  const normLo = normVals.length ? Math.min(...normVals) : 0;
  const normHi = normVals.length ? Math.max(...normVals) : 1;
  const normPad = Math.max((normHi - normLo) * 0.1, 0.01);
  const d0 = useNorm ? normLo - normPad : (series.axis_min ?? 0);
  const d1 = useNorm ? normHi + normPad : (series.axis_max ?? 1);
  const y = (v: number): number => scaleLinear(v, d0, d1, BOX.h - BOX.b, BOX.t);
  const band: GroupBand | null = series.group_band;
  const xAt = (m: number): number => scaleLinear(m, x0 - 0.5, x1 + 0.5, BOX.l, BOX.w - BOX.r);
  const ticks = useNorm ? [] : [d0, (d0 + d1) / 2, d1];
  const decimals = Math.abs(d1 - d0) < 1 ? 2 : Math.abs(d1 - d0) < 10 ? 1 : 0;

  return (
    <svg
      className="mr-chart" viewBox={`0 0 ${BOX.w} ${BOX.h}`} role="img" aria-label={`${title} 시간 그래프`}
      preserveAspectRatio="xMidYMid meet"
    >
      {segments.map((seg) => {
        const isBefore = seg.key === 'prep';
        const isAfter = seg.key === 'second_half';
        const xa = xAt(seg.start_min - 0.5);
        const xb = xAt(seg.end_min + 0.5);
        const mid = (xa + xb) / 2;
        return (
          <g key={seg.key}>
            <rect
              x={xa} y={BOX.t} width={Math.max(xb - xa, 0)} height={BOX.h - BOX.b - BOX.t}
              className={isBefore || isAfter ? 'mr-seg mr-seg-focus' : 'mr-seg'}
            />
            <text x={mid} y={BOX.h - 10} textAnchor="middle" className="mr-axis-text">
              {isBefore ? '전 ' : isAfter ? '후 ' : ''}{seg.label}
            </text>
          </g>
        );
      })}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={BOX.l} x2={BOX.w - BOX.r} y1={y(t)} y2={y(t)} className="mr-grid" />
          <text x={BOX.l - 6} y={y(t) + 3} textAnchor="end" className="mr-axis-text">{t.toFixed(decimals)}</text>
        </g>
      ))}
      {band && (
        <g>
          <path d={areaPath(xs, band.p10, band.p90, y)} className="mr-band-outer" />
          <path d={areaPath(xs, band.p25, band.p75, y)} className="mr-band-inner" />
          <path d={linePath(xs, band.p50, y)} className="mr-band-mid" />
        </g>
      )}
      {!useNorm && mySegments.map((s) => {
        const seg = segments.find((g) => g.key === s.segment_key);
        if (!seg || s.value === null) return null;
        return (
          <line
            key={s.segment_key} x1={xAt(seg.start_min - 0.5)} x2={xAt(seg.end_min + 0.5)}
            y1={y(s.value)} y2={y(s.value)} className="mr-seg-median"
          />
        );
      })}
      <path d={linePath(xs, mine, y)} className="mr-line" />
    </svg>
  );
}
