// 접촉불량 풀스크린 모달 — 1.0 LeadOffModal 패리티

import { useEffect, useRef } from 'react';
import type { LeadOffStatus } from '../../lib/eeg/types/eeg';
import { SensorTracker } from './SensorTracker';

interface LeadOffModalProps {
  isVisible: boolean;
  leadOff: LeadOffStatus | null;
  onDismiss: () => void;
}

export function LeadOffModal({ isVisible, leadOff, onDismiss }: LeadOffModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // SDD-132(②-5): Escape 닫기 + 열릴 때 포커스 이동
  useEffect(() => {
    if (!isVisible) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isVisible, onDismiss]);

  if (!isVisible) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-black px-6 py-10 text-white outline-none"
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
        </p>

        {/* SDD-131(②-4): 접촉불량 복구 절차 안내 */}
        <ol className="mt-6 max-w-md space-y-2 text-left text-[clamp(13px,2vw,15px)] leading-6 text-[color:var(--mb-white-70)]">
          <li>① 밴드를 이마 중앙에 맞춰 전극 패널이 피부에 밀착되도록 조여 주세요.</li>
          <li>② 머리카락이나 땀·이물이 센서를 가리지 않도록 정리한 뒤 다시 착용해 주세요.</li>
          <li>③ 밀착되면 수치가 다시 표시됩니다. 표시되지 않으면 벗었다가 다시 착용해 주세요.</li>
        </ol>

        <div className="mt-16 w-full">
          <SensorTracker leadOff={leadOff} />
        </div>

        <div className="mt-auto w-full pt-16">
          <button
            type="button"
            onClick={onDismiss}
            autoFocus
            className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base"
          >
            무시하기
          </button>
        </div>
      </div>
    </div>
  );
}
