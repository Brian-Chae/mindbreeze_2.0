// 리포트 샘플 가로 마퀴 — 1.0 InfiniteScrollingImages 패리티
// 208×368, 장당 3초, CSS animation / prefers-reduced-motion 정지

import type { CSSProperties } from 'react';

const REPORT_SAMPLES = [
  '/images/reports/report_sample_1.png',
  '/images/reports/report_sample_2.png',
  '/images/reports/report_sample_3.png',
  '/images/reports/report_sample_4.png',
  '/images/reports/report_sample_5.png',
  '/images/reports/report_sample_6.png',
] as const;

const IMAGE_WIDTH = 208;
const IMAGE_HEIGHT = 368;
/** 장당 3초 × 이미지 수 */
const DURATION_SEC = REPORT_SAMPLES.length * 3;

interface InfiniteScrollingImagesProps {
  className?: string;
}

export function InfiniteScrollingImages({ className = '' }: InfiniteScrollingImagesProps) {
  // 끊김 없는 루프를 위해 세트를 2번 나란히 배치
  const loopImages = [...REPORT_SAMPLES, ...REPORT_SAMPLES];
  const trackWidth = REPORT_SAMPLES.length * IMAGE_WIDTH;

  const trackStyle: CSSProperties = {
    width: trackWidth * 2,
    animation: `mb-report-marquee ${DURATION_SEC}s linear infinite`,
  };

  return (
    <div
      className={`w-full overflow-hidden ${className}`}
      style={{ height: IMAGE_HEIGHT }}
      aria-hidden="true"
    >
      <style>{`
        @keyframes mb-report-marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-${trackWidth}px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mb-report-marquee-track {
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>
      <div className="mb-report-marquee-track flex flex-row" style={trackStyle}>
        {loopImages.map((src, index) => (
          <img
            key={`${src}-${index}`}
            src={src}
            alt=""
            width={IMAGE_WIDTH}
            height={IMAGE_HEIGHT}
            className="shrink-0 object-cover"
            style={{ width: IMAGE_WIDTH, height: IMAGE_HEIGHT }}
            draggable={false}
          />
        ))}
      </div>
    </div>
  );
}
