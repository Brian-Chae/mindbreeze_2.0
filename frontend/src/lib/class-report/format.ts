import type { Direction } from './types';
export function formatValue(value: number | null | undefined, digits = 1): string {
  return value == null ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}
export const formatNumber = formatValue;
export function formatDelta(value: number | null | undefined): string {
  return value == null ? '—' : `${value > 0 ? '+' : ''}${formatValue(value)}`;
}
export function formatEditedAt(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function directionLabel(direction: Direction | null): string {
  return direction === 'up' ? '증가' : direction === 'down' ? '감소' : direction === 'stable' ? '유지' : '—';
}
