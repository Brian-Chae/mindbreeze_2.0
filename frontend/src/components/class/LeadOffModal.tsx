// 접촉불량 풀스크린 모달 — 1.0 LeadOffModal 패리티

import type { LeadOffStatus } from '../../lib/eeg/types/eeg';
import { SensorTracker } from './SensorTracker';

interface LeadOffModalProps {
  isVisible: boolean;
  leadOff: LeadOffStatus | null;
  onDismiss: () => void;
}

export function LeadOffModal({ isVisible, leadOff, onDismiss }: LeadOffModalProps) {
  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black px-6 py-10 text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-off-title"
    >
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center text-center">
        <h2
          id="lead-off-title"
          className="text-[clamp(20px,4vw,24px)] font-semibold leading-tight"
        >
          LINK BAND 위치를 조정해주세요
        </h2>
        <p className="mt-5 max-w-md text-[clamp(14px,2.5vw,18px)] leading-7 text-[color:var(--mb-white-70)]">
          LINK 밴드 내부의 전극 중 빨간색으로 표시된 센서 패널의 밀착 정도를 높이기 위해 밴드
          크기를 내 머리에 맞도록 조정해주세요.
          <br />
          <br />
          집중도를 측정하기 위해서는 각각의 센서가 잘 밀착되어야 해요.
        </p>

        <div className="mt-16 w-full">
          <SensorTracker leadOff={leadOff} />
        </div>

        <div className="mt-auto w-full pt-16">
          <button
            type="button"
            onClick={onDismiss}
            className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base"
          >
            무시하기
          </button>
        </div>
      </div>
    </div>
  );
}
