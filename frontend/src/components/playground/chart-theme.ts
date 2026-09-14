/** Playground 차트 색상 토큰 — brand #5F0080 */

export const CHART_COLORS = {
  primary: '#5F0080',
  accent: '#9B30FF',
  blue: '#38bdf8',
  pink: '#f472b6',
  warning: '#fbbf24',
  grid: 'rgba(255,255,255,0.06)',
} as const;

export const CATEGORY_PALETTE = [
  '#5F0080',
  '#38bdf8',
  '#f472b6',
  '#fbbf24',
  '#34d399',
  '#a78bfa',
] as const;

export const AXIS_TICK = { fill: '#9ca3af', fontSize: 11 } as const;

export const TOOLTIP_STYLE = {
  backgroundColor: '#111827',
  border: '1px solid #374151',
  borderRadius: 8,
  fontSize: 12,
} as const;
