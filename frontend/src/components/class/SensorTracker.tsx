// LINK BAND 전극 LED 그리드 — 1.0 SensorTracker 패리티
// 2.0 LeadOffStatus(ch1/ch2: true=분리) → 좌/기준/우 LED로 매핑

import type { LeadOffStatus } from '../../lib/eeg/types/eeg';

interface SensorTrackerProps {
  leadOff: LeadOffStatus | null;
  className?: string;
}

const GOOD = 'var(--mb-mint)'; // #01F0C8
const BAD = 'var(--mb-danger-deep)'; // #D33F3F

export function SensorTracker({ leadOff, className = '' }: SensorTrackerProps) {
  // ch true = 분리(불량) → LED는 접촉 양호 시 민트
  const leftOk = leadOff ? !leadOff.ch1 : false;
  const rightOk = leadOff ? !leadOff.ch2 : false;
  const refOk = leftOk && rightOk;

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <svg
        width="288"
        height="64"
        viewBox="0 0 288 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="LINK BAND 센서 접촉 상태"
      >
        <rect x="1" y="1" width="286" height="62" rx="23" stroke="#353842" strokeWidth="2" />
        {/* 좌측 채널 */}
        <rect x="39" y="20" width="30" height="22" rx="11" stroke="#606276" strokeWidth="2" />
        <rect x="42" y="23" width="24" height="16" rx="8" fill={leftOk ? GOOD : BAD} />
        {/* 기준(ref) — 좌·우 모두 양호할 때만 민트 */}
        <rect x="84" y="20" width="30" height="22" rx="11" stroke="#606276" strokeWidth="2" />
        <rect x="87" y="23" width="24" height="16" rx="8" fill={refOk ? GOOD : BAD} />
        {/* 우측 채널 */}
        <rect x="219" y="20" width="30" height="22" rx="11" stroke="#606276" strokeWidth="2" />
        <rect x="222" y="23" width="24" height="16" rx="8" fill={rightOk ? GOOD : BAD} />
        {/* 중앙 기준 표시 */}
        <path
          d="M147 18H141C136.029 18 132 22.0294 132 27V33C132 37.9706 136.029 42 141 42H147C151.971 42 156 37.9706 156 33V27C156 22.0294 151.971 18 147 18Z"
          fill={refOk ? GOOD : BAD}
        />
        <text x="24" y="38" fill="#EFEFEF" fontSize="12" fontFamily="sans-serif">
          L
        </text>
        <text x="256" y="38" fill="#EFEFEF" fontSize="12" fontFamily="sans-serif">
          R
        </text>
      </svg>
      <div className="mt-4 flex items-center justify-center gap-6 text-sm text-[#EFEFEF]">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: GOOD }}
            aria-hidden="true"
          />
          접촉 양호
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: BAD }}
            aria-hidden="true"
          />
          접촉 실패
        </span>
      </div>
    </div>
  );
}
