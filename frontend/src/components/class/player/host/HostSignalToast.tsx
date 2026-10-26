import { useEffect, useRef, useState } from 'react';
import type { SignalToast, SignalTopic } from './host-signal-toast';
export interface HostSignalToastProps {
  toast: SignalToast;
  onOpen: (topic: SignalTopic) => void;
  onDismiss: (topic: SignalTopic) => void;
  onPause?: () => void;
  onResume?: () => void;
}
/** 무음 알림. 시각 갱신은 즉시, 반복 발화만 초당 한 번으로 통합한다. */
export function HostSignalToast({ toast, onOpen, onDismiss, onPause, onResume }: HostSignalToastProps) {
  const rows = toast.rows ?? [toast];
  const text = rows.map((row) => `${row.message} ${row.detail ?? ''}`).join('. ');
  const [announcement, setAnnouncement] = useState(text);
  const latest = useRef(text);
  const lastRead = useRef(Date.now());
  const held = useRef({ hover: false, focus: false });
  const hold = (kind: 'hover' | 'focus', value: boolean) => {
    const before = held.current.hover || held.current.focus;
    held.current[kind] = value;
    const after = held.current.hover || held.current.focus;
    if (!before && after) onPause?.();
    if (before && !after) onResume?.();
  };
  const resumeRef = useRef(onResume);
  resumeRef.current = onResume;
  useEffect(() => () => {
    if (held.current.hover || held.current.focus) resumeRef.current?.();
  }, []);
  useEffect(() => {
    latest.current = text;
    const delay = Math.max(0, lastRead.current + 1000 - Date.now());
    const timer = window.setTimeout(() => { setAnnouncement(latest.current); lastRead.current = Date.now(); }, delay);
    return () => window.clearTimeout(timer);
  }, [text]);
  return <div className="w-full max-h-[224px] overflow-y-auto rounded-2xl border border-[#74638d] bg-[#292334] p-2 text-[15px] text-white shadow-lg" onMouseEnter={() => hold('hover', true)} onMouseLeave={() => hold('hover', false)} onFocusCapture={() => hold('focus', true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) hold('focus', false); }}>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    {rows.map((row) => <div key={row.topic} className="flex items-center gap-2">
      <button type="button" className="min-h-[44px] min-w-0 flex-1 px-3 text-left" onClick={() => onOpen(row.topic)}>{row.message}<span className="block text-[13px] text-[#d3c9de]">{row.detail ?? '탭해서 확인'}</span></button>
      <button type="button" aria-label={`${row.topic === 'hands' ? '손들기' : row.topic === 'signals' ? '신호' : '입장 대기'} 알림 닫기`} className="min-h-[44px] min-w-[44px] rounded-xl" onClick={() => onDismiss(row.topic)}>×</button>
    </div>)}
  </div>;
}
