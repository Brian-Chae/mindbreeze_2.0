// SDD-265: 상황판 공용 조각(상태 배지·전송 막대·숫자 카드). 정본 시안 안3-A. 화면 어디에도 점수·완료·보증 표현을 쓰지 않는다.
import type { ReactNode } from 'react';
import { BOARD_ICON, BOARD_TONE, FINAL_PENDING_CHIP, type BoardState } from '../../lib/upload-status/board';

export const fieldClass = 'min-h-11 min-w-0 rounded-[10px] border border-[#E8E2ED] bg-white px-3 text-[14px] text-[#5F0080]';
export const cardClass = 'rounded-[20px] border border-[#E8E2ED] bg-white p-4 md:p-5';

export function StateBadge({ state, label, className = '' }: { state: BoardState; label: string; className?: string }) {
  return (
    <span data-testid="state-badge" data-state={state} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${BOARD_TONE[state]} ${className}`}>
      <span aria-hidden="true">{BOARD_ICON[state]}</span>{label}
    </span>
  );
}

/** SDD-267: 모두 도착 · 최종 확인 대기 칩. 중립색(경고 아님). */
export function FinalPendingChip({ className = '' }: { className?: string }) {
  return <span data-testid="final-pending-chip" className={`inline-flex items-center gap-1 rounded-full bg-[#F2EFF5] px-2.5 py-0.5 text-[12px] font-semibold text-[#655173] ${className}`}><span aria-hidden="true">◷</span>{FINAL_PENDING_CHIP}</span>;
}

/** 전송 막대. percent 가 null 이면 '집계 대기' 줄무늬(0% 로 보이지 않게). */
export function TransferBar({ percent, label = '전송 현황', thin = false }: { percent: number | null; label?: string; thin?: boolean }) {
  const h = thin ? 'h-1' : 'h-2';
  return percent === null
    ? <div data-testid="transfer-bar" data-unknown="true" aria-hidden="true" className={`${h} my-1 overflow-hidden rounded-full bg-[repeating-linear-gradient(90deg,#E8E2ED_0_8px,#F8F5FA_8px_16px)]`} />
    : (
      <div data-testid="transfer-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={`${h} my-1 overflow-hidden rounded-full bg-[#EEE8F1]`}>
        <i className="block h-full bg-[#5F0080]" style={{ width: `${percent}%` }} />
      </div>
    );
}

export function Metric({ title, value, sub, testId, compact = false }: { title: string; value: ReactNode; sub?: ReactNode; testId?: string; compact?: boolean }) {
  return (
    <div data-testid={testId} className={`min-w-0 rounded-2xl bg-[#F8F5FA] ${compact ? 'p-2 md:p-4' : 'p-3 md:p-4'}`}>
      <p className="text-[12px] text-[#776D7B]">{title}</p>
      <p className={`my-1 break-words font-bold leading-tight tracking-tight text-[#29232E] md:text-[29px] ${compact ? 'text-[18px]' : 'text-[25px]'}`}>{value}</p>
      {sub && <p className="text-[12px] text-[#776D7B]">{sub}</p>}
    </div>
  );
}
