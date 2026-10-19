import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Minus, Plus, X } from 'lucide-react';

export function WizardField({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <div className={`w-group ${className}`}><span className="fl-label">{title}</span>{children}</div>;
}
export function WizardStepper({ label, value, onChange, min, max, step = 1, unit = '', name, prefix = '' }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number; unit?: string; name?: string; prefix?: string }) {
  return <div className="w-stepper"><button type="button" aria-label={`${label} 줄이기`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Minus size={20} /></button><label className="cw-number">{prefix && <span>{prefix}</span>}<input aria-label={label} name={name} type="number" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /><span>{unit}</span></label><button type="button" aria-label={`${label} 늘리기`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Plus size={20} /></button></div>;
}
export function WizardDateTime({ label, value, type, min, max, onChange }: { label: string; value: string; type: 'date' | 'time'; min: string; max?: string; onChange: (value: string) => void }) {
  function move(direction: number) {
    if (type === 'date') { const date = new Date(`${value}T12:00:00Z`); if (Number.isNaN(date.getTime())) return; date.setUTCDate(date.getUTCDate() + direction); onChange(date.toISOString().slice(0, 10)); }
    else { const [hour, minute] = value.split(':').map(Number); const total = hour * 60 + minute + direction * 5; onChange(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`); }
  }
  const date = type === 'date' ? new Date(`${value}T12:00:00Z`) : null;
  const [hour, minute] = value.split(':').map(Number);
  const display = type === 'date' ? date && !Number.isNaN(date.getTime()) ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${'일월화수목금토'[date.getUTCDay()]})` : '날짜 선택' : `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${String(minute).padStart(2, '0')}`;
  return <div className="w-stepper sm"><button type="button" aria-label={`${label} 이전`} disabled={value <= min} onClick={() => move(-1)}><Minus size={20} /></button><label className="cw-datetime"><span aria-hidden="true">{display}</span><input aria-label={label} type={type} min={min} max={max} step={type === 'time' ? 300 : undefined} value={value} onChange={event => onChange(event.target.value)} /></label><button type="button" aria-label={`${label} 다음`} disabled={Boolean(max && value >= max)} onClick={() => move(1)}><Plus size={20} /></button></div>;
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
