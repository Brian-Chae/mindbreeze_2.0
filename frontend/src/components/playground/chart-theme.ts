/** Playground 차트 색상 토큰 — mindbreeze brand #5F0080 */

export const CHART_COLORS = {
  primary: '#5F0080',
  accent: '#9B30FF',
  blue: '#7C3AED',
  pink: '#C084FC',
  warning: '#D97706',
  grid: 'rgba(95,0,128,0.08)',
} as const;

export const CATEGORY_PALETTE = [
  '#5F0080',
  '#7C3AED',
  '#A855F7',
  '#C084FC',
  '#6E1A8C',
  '#9B30FF',
] as const;

export const AXIS_TICK = { fill: '#6F6F6F', fontSize: 11 } as const;

export const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  border: '1px solid #EFEFEF',
  borderRadius: 8,
  fontSize: 12,
  color: '#1F1F1F',
} as const;
