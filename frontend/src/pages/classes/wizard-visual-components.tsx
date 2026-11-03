import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { StartDatePicker } from '../../components/class/flow/host/start-date-picker';
import { StartTimePicker } from '../../components/class/flow/host/start-time-picker';
import { formatClock, parseClock } from '../../lib/class/start-time';

export function WizardField({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <div className={`w-group ${className}`}><span className="fl-label">{title}</span>{children}</div>;
}
export function WizardStepper({ label, value, onChange, min, max, step = 1, unit = '', name, prefix = '' }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number; unit?: string; name?: string; prefix?: string }) {
  // 입력 중 글자는 따로 들고 있는다. 숫자로만 보관하면 다 지웠을 때 0이 끼고 "04"처럼 앞자리 0이 남는다.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  function typed(raw: string) {
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (digits === '') { setDraft(''); return; }
    const next = Number(digits);
    if (next > max) { setDraft(String(max)); onChange(max); return; }
    setDraft(digits);
    if (next >= min) onChange(next);
  }
  function settle() {
    const base = draft === '' ? value : Number(draft);
    const snapped = step > 1 ? Math.round(base / step) * step : base;
    const next = Math.min(max, Math.max(min, snapped));
    setDraft(String(next));
    if (next !== value) onChange(next);
  }
  return <div className="w-stepper"><button type="button" aria-label={`${label} 줄이기`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Minus size={20} /></button><label className="cw-number">{prefix && <span>{prefix}</span>}<input aria-label={label} name={name} type="number" inputMode="numeric" min={min} max={max} step={step} value={draft} onChange={event => typed(event.target.value)} onBlur={settle} /><span>{unit}</span></label><button type="button" aria-label={`${label} 늘리기`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Plus size={20} /></button></div>;
}
export function WizardDateTime({ label, value, type, min, max, onChange }: { label: string; value: string; type: 'date' | 'time'; min: string; max?: string; onChange: (value: string) => void }) {
  // SDD-279 보정: 시작 시각은 ± 스테퍼 대신 C-3 팝업(데스크톱) / 시·분 select(모바일). 값은 "HH:MM" 문자열 그대로.
  if (type === 'time') {
    const minMin = parseClock(min) ?? undefined; const maxMin = max ? parseClock(max) ?? undefined : undefined;
    return <div className="cw-timepick"><StartTimePicker timeMin={parseClock(value) ?? minMin ?? 420} minMin={minMin} maxMin={maxMin} onChange={timeMin => onChange(formatClock(timeMin))} /></div>;
  }
  // SDD-281: 시작 날짜는 −/+ 스테퍼 대신 단일 필드 + 캘린더(데스크톱 팝오버 / 모바일 Bottom Sheet). 값은 "YYYY-MM-DD" 그대로.
  return <div className="cw-datepick"><StartDatePicker label={label} value={value} min={min} max={max} onChange={onChange} /></div>;
}
export function WizardToggle({ title, checked, onChange, children }: { title: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return <button type="button" className="fl-row w-tog" role="switch" aria-checked={checked} onClick={onChange}>{children}<span className="tx"><b>{title}</b></span><span className="sw" /></button>;
}
export function WizardSheet({ title, children, footer, onClose }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  const id = useId(); const ref = useRef<HTMLElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => { previous?.focus(); };
  }, []);
  return <div className="w-scrim" onClick={event => { if (event.target === event.currentTarget) close.current(); }}><section ref={ref} className="w-sheet" role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); close.current(); }
    if (event.key !== 'Tab') return;
    const targets = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? [])];
    const first = targets[0]; const last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}><header className="w-shead"><h2 id={id}>{title}</h2><button className="w-x" aria-label="닫기" onClick={onClose}><X size={20} /></button></header><div className="w-sbody sc">{children}</div><footer className="w-sfoot">{footer}</footer></section></div>;
}
