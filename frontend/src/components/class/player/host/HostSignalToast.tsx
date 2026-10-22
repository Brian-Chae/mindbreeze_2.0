import type { SignalToast, SignalTopic } from './host-signal-toast';
export interface HostSignalToastProps {
  toast: SignalToast;
  onOpen: (topic: SignalTopic) => void;
  onDismiss: () => void;
  onPause?: () => void;
  onResume?: () => void;
}
/** 무음 알림. 포커스를 가져오지 않으며 알림을 눌러도 조치를 실행하지 않는다. */
export function HostSignalToast({ toast, onOpen, onDismiss, onPause, onResume }: HostSignalToastProps) {
  return <div role="status" aria-live="polite" className="flex w-full items-center gap-2 rounded-2xl border border-[#74638d] bg-[#292334] p-2 text-[15px] text-white shadow-lg" onMouseEnter={onPause} onMouseLeave={onResume} onFocusCapture={onPause} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onResume?.(); }}>
    <button type="button" className="min-h-[44px] flex-1 px-3 text-left" onClick={() => onOpen(toast.topic)}>{toast.message}<span className="block text-[13px] text-[#d3c9de]">탭해서 확인</span></button>
    <button type="button" aria-label="신호 알림 닫기" className="min-h-[44px] min-w-[44px] rounded-xl" onClick={onDismiss}>×</button>
  </div>;
}
