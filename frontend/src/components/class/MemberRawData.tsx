// SDD-125 후속: 회원용 raw 데이터 파형 — 뇌파(EEG 2ch)·심박(PPG IR/RED)·움직임(ACC magnitude).
// 우측 디바이스 패널에서 EEG:PPG:ACC = 2:1:1 높이 비율로 노출한다(member-class-player.css).
// EEG 위 CHIP(집중·이완·감정균형), PPG 위 CHIP(BPM·HRV·호흡수),
// ACC 위 CHIP(움직임·활동·안정도). useBand 의 supplier(get*WaveformSamples)를 rAF 루프에서 직접
// 읽어 React 리렌더 없이 그린다(250Hz 렌더 부하 최소화). ResizeObserver로 패널 폭 변경 시 자동 재할당.

import { useEffect, useRef, type ReactNode } from 'react';
import type { UseBandResult } from '../../hooks/useBand';

interface DarkWaveformSeries {
  id: string;
  color: string;
}

type WaveformSupplier = () => Record<string, ArrayLike<number>>;

interface DarkWaveformProps {
  series: DarkWaveformSeries[];
  supplier: WaveformSupplier;
  /** 연결되지 않으면 그리지 않는다(빈 캔버스 유지) */
  active: boolean;
  /** 파형이 유효한지(정상 여부 배지용) */
  hasSignal: boolean;
  /** 캔버스 위 오버레이 CHIP (라벨 + 현재값) */
  chips?: { label: string; value: string }[];
}

const GRID_COLOR = 'rgba(255,255,255,0.06)';

function DarkWaveform({ series, supplier, active, hasSignal, chips }: DarkWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const supplierRef = useRef(supplier);
  const activeRef = useRef(active);
  const seriesRef = useRef(series);
  const scaleRef = useRef<Record<string, number>>({});

  useEffect(() => {
    supplierRef.current = supplier;
    activeRef.current = active;
    seriesRef.current = series;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const applySize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth || 1;
      const cssHeight = canvas.clientHeight || 1;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(canvas);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || !activeRef.current) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        const y = (h / 3) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const data = supplierRef.current();
      const trackCount = Math.max(1, seriesRef.current.length);
      const trackHeight = h / trackCount;

      seriesRef.current.forEach((s, trackIndex) => {
        const values = data[s.id];
        if (!values || values.length < 2) return;
        const top = trackHeight * trackIndex;
        const mid = top + trackHeight / 2;

        let peak = 0;
        for (let i = 0; i < values.length; i++) {
          const a = Math.abs(values[i]);
          if (a > peak) peak = a;
        }
        const prev = scaleRef.current[s.id] ?? peak;
        let amplitude = Math.max(1e-6, prev * 0.85 + peak * 0.15);
        if (peak > prev) amplitude = peak;
        scaleRef.current[s.id] = amplitude;
        const toY = (v: number) => mid - (v / amplitude) * (trackHeight / 2 - 3);

        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.25;
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
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <span className={`member-raw-wave${hasSignal ? '' : ' is-idle'}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {chips && chips.length > 0 && (
        <span className="member-raw-chips">
          {chips.map((c) => (
            <span key={c.label} className="member-raw-chip">
              {c.label} <b>{c.value}</b>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function RawBlock({
  label,
  sub,
  series,
  supplier,
  active,
  hasSignal,
  chips,
  foot,
}: {
  label: string;
  sub: string;
  series: DarkWaveformSeries[];
  supplier: WaveformSupplier;
  active: boolean;
  hasSignal: boolean;
  chips?: { label: string; value: string }[];
  foot: ReactNode;
}) {
  return (
    <div className="member-raw-block">
      <header className="member-raw-head">
        <span className="member-raw-title">
          {label} <small style={{ fontSize: 10, fontWeight: 400, color: 'var(--player-muted)' }}>{sub}</small>
        </span>
        <span className={`member-raw-status${hasSignal ? '' : ' is-idle'}`}>
          {hasSignal ? '정상' : '대기'}
        </span>
      </header>
      <DarkWaveform series={series} supplier={supplier} active={active} hasSignal={hasSignal} chips={chips} />
      <footer className="member-raw-foot">{foot}</footer>
    </div>
  );
}

const fmt = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v));

/** ACC 활동 상태 한국어 라벨 (stationary/sitting/walking/running) */
const ACC_ACTIVITY_LABEL: Record<string, string> = {
  stationary: '정지',
  sitting: '앉음',
  walking: '걷기',
  running: '달리기',
};

export function MemberRawData({ band }: { band: UseBandResult }) {
  const connected = band.connectionState === 'connected';
  const eeg = band.getEegWaveformSamples();
  const ppg = band.getPpgWaveformSamples();
  const acc = band.getAccWaveformSamples();
  const accSnapshot = band.acc;
  const s = band.scoredIndices;
  const activityLabel = ACC_ACTIVITY_LABEL[accSnapshot.activityType] ?? accSnapshot.activityType;

  return (
    <div className="member-raw-grid">
      <RawBlock
        label="뇌파 EEG"
        sub="(2ch · 250Hz)"
        series={[
          { id: 'fp1', color: '#DCB5EE' },
          { id: 'fp2', color: '#01f0c8' },
        ]}
        supplier={() => band.getEegWaveformSamples()}
        active={connected}
        hasSignal={connected && eeg.fp1.length > 1}
        chips={[
          { label: '집중도', value: fmt(s?.focusIndex) },
          { label: '이완도', value: fmt(s?.relaxationIndex) },
          { label: '감정균형도', value: fmt(s?.emotionalStability) },
        ]}
        foot={<>Fp1 · Fp2 · 250Hz</>}
      />
      <RawBlock
        label="심박 PPG"
        sub="(IR · RED)"
        series={[
          { id: 'ir', color: '#ffa657' },
          { id: 'red', color: '#ff5c7a' },
        ]}
        supplier={() => {
          const p = band.getPpgWaveformSamples();
          return { ir: p.ir, red: p.red };
        }}
        active={connected}
        hasSignal={connected && ppg.ir.length > 1}
        chips={[
          { label: 'BPM', value: fmt(band.heartRate) },
          { label: 'HRV', value: fmt(band.sdnn) },
          { label: '호흡수', value: fmt(band.respiratoryRate) },
        ]}
        foot={
          <>
            <span>
              <span className="meta-dot" style={{ background: '#ff5c7a' }} />
              RED 660nm
            </span>
            <span>
              <span className="meta-dot" style={{ background: '#ffa657' }} />
              IR 940nm
            </span>
          </>
        }
      />
      <RawBlock
        label="움직임 ACC"
        sub="(magnitude · 30Hz)"
        series={[{ id: 'mag', color: '#FFD166' }]}
        supplier={() => ({ mag: band.getAccWaveformSamples() })}
        active={connected}
        hasSignal={connected && acc.length > 1}
        chips={[
          { label: '움직임', value: fmt(accSnapshot.avgMovement) },
          { label: '활동', value: activityLabel },
          { label: '안정도', value: fmt(accSnapshot.stability) },
        ]}
        foot={
          <>
            <span>3축 가속도 크기(중력 제거)</span>
            <span>{activityLabel}</span>
          </>
        }
      />
    </div>
  );
}
