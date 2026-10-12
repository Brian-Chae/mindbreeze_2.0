// "AI 분석중" 깜빡임 텍스트 — 1.0 BlinkingText CSS keyframes 이식
// opacity 1↔0.1, 3초 왕복 / prefers-reduced-motion 시 고정

import type { ReactNode } from 'react';

interface BlinkingTextProps {
  children: ReactNode;
  className?: string;
}

export function BlinkingText({ children, className = '' }: BlinkingTextProps) {
  return (
    <span className={`mb-blink ${className}`}>
      {children}
      <style>{`
        @keyframes mb-blink-opacity {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.1; }
        }
        .mb-blink {
          animation: mb-blink-opacity 3s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .mb-blink {
            animation: none;
            opacity: 1;
          }
        }
      `}</style>
    </span>
  );
}
