/**
 * 공용 Canvas 2D 파형 렌더러.
 * store 구독 없음 — supplier로 rAF에서 읽어 React 리렌더 0.
 */

import { useEffect, useRef } from 'react';

export interface WaveformSeries {
  id: string;
  color: string;
  label?: string;
}

export type WaveformSupplier = () => Record<string, ArrayLike<number>>;
export type BandSupplier = () => Array<{ from: number; to: number }>;
export type WaveformSize = 'sm' | 'md' | 'lg';

interface Props {
  series: WaveformSeries[];
  supplier: WaveformSupplier;
  yRange?: [number, number];
  size?: WaveformSize;
  autoScaleSmoothing?: number;
  paused?: boolean;
  stacked?: boolean;
  highlightBands?: BandSupplier;
}

const SIZE_CLASS: Record<WaveformSize, string> = {
  sm: 'h-24',
  md: 'h-40',
  lg: 'h-56',
};

const SIZE_PX: Record<WaveformSize, number> = { sm: 96, md: 160, lg: 224 };
const GRID_COLOR = 'rgba(255,255,255,0.06)';
const HIGHLIGHT_COLOR = 'rgba(255,82,82,0.18)';

export function WaveformCanvas({
  series,
  supplier,
  yRange,
  size = 'md',
  autoScaleSmoothing = 0.85,
  paused = false,
  stacked = true,
  highlightBands,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const supplierRef = useRef(supplier);
  const bandsRef = useRef(highlightBands);
  const pausedRef = useRef(paused);
  const scaleRef = useRef<Record<string, number>>({});
  const height = SIZE_PX[size];
  const sizeRef = useRef({ width: 0, height });

  useEffect(() => {
    supplierRef.current = supplier;
    bandsRef.current = highlightBands;
    pausedRef.current = paused;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const applySize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth || 1;
      sizeRef.current = { width: cssWidth, height };
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    applySize();

    const observer = new ResizeObserver(applySize);
    observer.observe(canvas);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || pausedRef.current) return;

      const { width: w, height: h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const bands = bandsRef.current?.() ?? [];
      if (bands.length > 0) {
        ctx.fillStyle = HIGHLIGHT_COLOR;
        for (const b of bands) {
          const x0 = Math.max(0, b.from) * w;
          const x1 = Math.min(1, b.to) * w;
          if (x1 > x0) ctx.fillRect(x0, 0, x1 - x0, h);
        }
      }

      const data = supplierRef.current();
      const trackCount = stacked ? Math.max(1, series.length) : 1;
      const trackHeight = h / trackCount;

      series.forEach((s, trackIndex) => {
        const values = data[s.id];
        if (!values || values.length < 2) return;

        const top = stacked ? trackHeight * trackIndex : 0;
        const mid = top + trackHeight / 2;

        let amplitude: number;
        if (yRange) {
          amplitude = Math.max(1e-6, (yRange[1] - yRange[0]) / 2);
        } else {
          let peak = 0;
          for (let i = 0; i < values.length; i++) {
            const a = Math.abs(values[i]);
            if (a > peak) peak = a;
          }
          const prev = scaleRef.current[s.id] ?? peak;
          amplitude = Math.max(
            1e-6,
            prev * autoScaleSmoothing + peak * (1 - autoScaleSmoothing),
          );
          if (peak > prev) amplitude = peak;
          scaleRef.current[s.id] = amplitude;
        }
        const toY = (v: number) => mid - (v / amplitude) * (trackHeight / 2 - 4);

        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1;
        ctx.beginPath();

        const n = values.length;
        if (n <= w) {
          for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * w;
            const y = toY(values[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        } else {
          const step = n / w;
          for (let px = 0; px < w; px++) {
            const start = Math.floor(px * step);
            const end = Math.min(n, Math.floor((px + 1) * step));
            let min = values[start];
            let max = values[start];
            for (let i = start + 1; i < end; i++) {
              const v = values[i];
              if (v < min) min = v;
              if (v > max) max = v;
            }
            if (px === 0) ctx.moveTo(px, toY(max));
            ctx.lineTo(px, toY(max));
            ctx.lineTo(px, toY(min));
          }
        }
        ctx.stroke();

        if (s.label) {
          ctx.fillStyle = s.color;
          ctx.font = '10px ui-sans-serif, system-ui';
          ctx.fillText(s.label, 4, top + 12);
        }
      });
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [series, yRange, height, autoScaleSmoothing, stacked]);

  return (
    <canvas
      ref={canvasRef}
      className={`block w-full rounded-lg bg-gray-950 ${SIZE_CLASS[size]}`}
    />
  );
}
