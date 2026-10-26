/** 몸 지표 고정 스케일을 실제 값이 벗어나면 클램프(평평한 선) 대신 표시 범위를 실제 min/max 까지 넓힌다. */
export function resolveBodyScale(scale: readonly [number, number], values: readonly number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [scale[0], scale[1]];
  const min = Math.min(...finite), max = Math.max(...finite);
  const pad = (max - min) * 0.05;
  return [
    min < scale[0] ? Math.floor(min - pad) : scale[0],
    max > scale[1] ? Math.ceil(max + pad) : scale[1],
  ];
}
