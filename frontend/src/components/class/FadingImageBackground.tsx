// 자연 이미지 교차 페이드 배경 — 1.0 FadingImageBackground 웹 이식
// 20초 간격 + 1초 opacity transition, cover, 무작위+직전 중복 방지

import { useEffect, useRef, useState, type CSSProperties } from 'react';

const IMAGE_COUNT = 10;
const IMAGE_CHANGE_INTERVAL_MS = 20_000;
const FADE_DURATION_MS = 1_000;

const IMAGE_PATHS: string[] = Array.from(
  { length: IMAGE_COUNT },
  (_, i) => `/images/background${i + 1}.webp`,
);

/** 직전 경로와 다른 이미지를 무작위로 고른다 */
function pickNextImage(current: string): string {
  if (IMAGE_PATHS.length <= 1) return IMAGE_PATHS[0] ?? current;
  let next = current;
  while (next === current) {
    next = IMAGE_PATHS[Math.floor(Math.random() * IMAGE_PATHS.length)]!;
  }
  return next;
}

interface FadingImageBackgroundProps {
  className?: string;
}

export function FadingImageBackground({ className = '' }: FadingImageBackgroundProps) {
  const [layerA, setLayerA] = useState(() =>
    IMAGE_PATHS[Math.floor(Math.random() * IMAGE_PATHS.length)]!,
  );
  const [layerB, setLayerB] = useState(layerA);
  /** true면 A가 보이는 쪽 */
  const [showA, setShowA] = useState(true);
  const showARef = useRef(true);
  const layerARef = useRef(layerA);
  const layerBRef = useRef(layerB);

  useEffect(() => {
    showARef.current = showA;
  }, [showA]);
  useEffect(() => {
    layerARef.current = layerA;
  }, [layerA]);
  useEffect(() => {
    layerBRef.current = layerB;
  }, [layerB]);

  // 명상 진입 시 전체 프리로드
  useEffect(() => {
    for (const src of IMAGE_PATHS) {
      const img = new Image();
      img.src = src;
    }
  }, []);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) return undefined;

    const id = window.setInterval(() => {
      const visible = showARef.current ? layerARef.current : layerBRef.current;
      const next = pickNextImage(visible);
      if (showARef.current) {
        setLayerB(next);
        layerBRef.current = next;
        setShowA(false);
        showARef.current = false;
      } else {
        setLayerA(next);
        layerARef.current = next;
        setShowA(true);
        showARef.current = true;
      }
    }, IMAGE_CHANGE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, []);

  const layerStyle = (src: string, visible: boolean): CSSProperties => ({
    backgroundImage: `url(${src})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    opacity: visible ? 1 : 0,
    transition: `opacity ${FADE_DURATION_MS}ms ease-in-out`,
  });

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 motion-reduce:transition-none"
        style={layerStyle(layerA, showA)}
      />
      <div
        className="absolute inset-0 motion-reduce:transition-none"
        style={layerStyle(layerB, !showA)}
      />
    </div>
  );
}
