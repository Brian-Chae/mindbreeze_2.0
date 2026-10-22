// LINK BAND 전극 LED 그리드 — 1.0 SensorTracker 패리티
// 2.0 LeadOffStatus(ch1/ch2: true=분리) → 좌/기준/우 LED로 매핑(deriveElectrodes).
// SDD-209: 3상태(양호·실패·미확인). 접촉 정보가 없으면(null) 회색 "미확인" — 거짓 접촉 불량(빨강) 표시를 하지 않는다.
// 색은 상태를 단독으로 전달하지 않는다: 전극별 aria-label + LED 아래 라벨 줄 + 범례. 체크·엑스 아이콘은 쓰지 않는다.
// 이 컴포넌트는 Tailwind/전역 클래스에 의존하지 않는다(인라인 스타일만) — LeadOffModal 등 .pz-root 밖에서도 같은 모양.

import type { CSSProperties, ReactElement } from 'react';
import type { LeadOffStatus } from '../../lib/eeg/types/eeg';
import { DEFAULT_ELECTRODE_COLORS, deriveElectrodes, type ElectrodeColors, type ElectrodeState } from '../../lib/class/band-step';

interface SensorTrackerProps {
  leadOff: LeadOffStatus | null;
  className?: string;
  /** 상태별 LED 색(기본 민트/빨강/회색) */
  colors?: ElectrodeColors;
}

const STATE_WORD: Record<ElectrodeState, string> = { good: '양호', bad: '실패', unknown: '미확인' };
const WRAP: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%', maxWidth: 288 };
const LABEL_ROW: CSSProperties = { position: 'relative', width: '100%', maxWidth: 288, height: 20 };
const LEGEND: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 24, minHeight: 24, fontSize: 13, color: '#EFEFEF' };
const LEGEND_ITEM: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8 };

export function SensorTracker({ leadOff, className = '', colors = DEFAULT_ELECTRODE_COLORS }: SensorTrackerProps) {
  const e = deriveElectrodes(leadOff);
  const fill = (s: ElectrodeState): string => colors[s];
  const anyUnknown = e.left === 'unknown' || e.right === 'unknown';
  const label = (leftPct: number, name: string, s: ElectrodeState): ReactElement => (
    <span
      key={name}
      data-state={s}
      style={{
        position: 'absolute', top: 0, left: `${leftPct}%`, transform: 'translateX(-50%)', fontSize: 'var(--sensor-caption-size, 12px)', lineHeight: '20px',
        whiteSpace: 'nowrap', color: s === 'bad' ? '#F7F4F0' : '#CFC6D6', fontWeight: s === 'bad' ? 700 : 400,
      }}
    >
      {name} {STATE_WORD[s]}
    </span>
  );

  return (
    <div className={className} style={WRAP} data-pz="flow-electrodes">
      {/* SDD-234: 모달에서도 동일하게 적용하고 768px 이상은 기존 12px을 유지한다. */}
      <style>{`@media (max-width: 767px) { [data-pz="flow-electrodes"] { --sensor-caption-size: var(--mobile-type-caption-size); } }`}</style>
      <svg
        viewBox="0 0 288 64"
        width="100%"
        style={{ display: 'block', maxWidth: 288, height: 'auto', aspectRatio: '288 / 64' }}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        aria-label={`LINK BAND 전극 접촉 상태: 왼쪽 ${STATE_WORD[e.left]}, 기준 ${STATE_WORD[e.ref]}, 오른쪽 ${STATE_WORD[e.right]}`}
      >
        <rect x="1" y="1" width="286" height="62" rx="23" stroke="#353842" strokeWidth="2" />
        {/* 좌측 채널 */}
        <g role="img" aria-label={`왼쪽 전극 접촉 ${STATE_WORD[e.left]}`} data-led="L" data-state={e.left}>
          <rect x="39" y="20" width="30" height="22" rx="11" stroke="#606276" strokeWidth="2" />
          <rect x="42" y="23" width="24" height="16" rx="8" fill={fill(e.left)} />
        </g>
        {/* 기준(ref) — 좌·우 모두 양호할 때만 양호 */}
        <g role="img" aria-label={`기준 전극 접촉 ${STATE_WORD[e.ref]}`} data-led="ref" data-state={e.ref}>
          <rect x="84" y="20" width="30" height="22" rx="11" stroke="#606276" strokeWidth="2" />
          <rect x="87" y="23" width="24" height="16" rx="8" fill={fill(e.ref)} />
          {/* 중앙 기준 표시 */}
          <path
            d="M147 18H141C136.029 18 132 22.0294 132 27V33C132 37.9706 136.029 42 141 42H147C151.971 42 156 37.9706 156 33V27C156 22.0294 151.971 18 147 18Z"
            fill={fill(e.ref)}
          />
        </g>
        {/* 우측 채널 */}
        <g role="img" aria-label={`오른쪽 전극 접촉 ${STATE_WORD[e.right]}`} data-led="R" data-state={e.right}>
          <rect x="219" y="20" width="30" height="22" rx="11" stroke="#606276" strokeWidth="2" />
          <rect x="222" y="23" width="24" height="16" rx="8" fill={fill(e.right)} />
        </g>
        <text x="24" y="38" fill="#EFEFEF" fontSize="var(--sensor-caption-size, 12px)" fontFamily="sans-serif">L</text>
        <text x="256" y="38" fill="#EFEFEF" fontSize="var(--sensor-caption-size, 12px)" fontFamily="sans-serif">R</text>
      </svg>
      <div style={LABEL_ROW} data-pz="flow-electrode-labels">
        {label((54 / 288) * 100, '왼쪽', e.left)}
        {label((144 / 288) * 100, '기준', e.ref)}
        {label((234 / 288) * 100, '오른쪽', e.right)}
      </div>
      <div style={LEGEND} data-pz="flow-electrode-legend">
        <span style={LEGEND_ITEM}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: colors.good }} aria-hidden="true" />
          접촉 양호
        </span>
        <span style={LEGEND_ITEM}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: colors.bad }} aria-hidden="true" />
          접촉 실패
        </span>
        {anyUnknown ? (
          <span style={LEGEND_ITEM}>
            <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: colors.unknown }} aria-hidden="true" />
            확인 전
          </span>
        ) : null}
      </div>
    </div>
  );
}
