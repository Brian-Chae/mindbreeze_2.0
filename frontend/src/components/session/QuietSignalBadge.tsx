// 개선 5: 상담사 카드의 무음 시그널 배지 — 은은한 아이콘·색조로 몇 초 표시 후 페이드.
//
// 소리·팝업 없음. 부모(ClassPlayerPage)가 TTL 만료 시 항목을 제거하므로
// 사라짐 자체는 CSS 애니메이션이 담당한다(급격한 unmount 로 깜빡이지 않게).
// 같은 유형이 다시 들어와도 애니메이션이 재시작되도록 부모가 key 를 새로 부여한다.

import {
  CLASS_SIGNAL_META,
  SIGNAL_FLASH_MS,
  type ActiveSignal,
} from '../../lib/class/quiet-signal';

interface QuietSignalBadgeProps {
  signal: ActiveSignal;
}

export function QuietSignalBadge({ signal }: QuietSignalBadgeProps) {
  const meta = CLASS_SIGNAL_META[signal.type];
  return (
    <span
      className={`mb-quiet-signal inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${meta.badgeClass}`}
      aria-label={`상태 신호: ${meta.label}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
      {meta.label}
      <style>{`
        @keyframes mb-quiet-signal-fade {
          0% { opacity: 0; transform: translateY(2px); }
          12% { opacity: 1; transform: translateY(0); }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
        .mb-quiet-signal {
          animation: mb-quiet-signal-fade ${SIGNAL_FLASH_MS}ms ease-out forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .mb-quiet-signal {
            animation: none;
          }
        }
      `}</style>
    </span>
  );
}
