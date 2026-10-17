// SDD-209 H1 — 상담사 흐름 공용 작은 부품(카드·묶음·안내 줄·세그먼트·스텝퍼·토글 행).
import type { ReactNode } from 'react';
import { AlertTriangle, Info, Minus, Plus } from 'lucide-react';

export function FhCard({ children, grow = false, extra }: { children: ReactNode; grow?: boolean; extra?: string }) {
  const cls = ['fl-card', 'fh-card', extra, grow ? 'fh-grow' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-pz="flow-card" data-strong="true">
      {children}
    </div>
  );
}

export function FhForm({ children }: { children: ReactNode }) {
  return <div className="fh-form">{children}</div>;
}

export function FhGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="fh-group">
      {label ? <span className="fl-label">{label}</span> : null}
      {children}
    </div>
  );
}

/** 설명 한 줄(정보/주의 아이콘 + 문구) */
export function FhInfo({ children, warn = false, role }: { children: ReactNode; warn?: boolean; role?: 'alert' | 'status' }) {
  const Icon = warn ? AlertTriangle : Info;
  return (
    <div className="fh-info" role={role}>
      <Icon size={20} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface FhSegProps<T extends string | number> {
  label: string;
  value: T;
  options: ReadonlyArray<SegOption<T>>;
  onChange: (value: T) => void;
  /** CSS 열 수 변형(fh-types, fh-c5 등) */
  variant?: string;
}

export function FhSeg<T extends string | number>({ label, value, options, onChange, variant }: FhSegProps<T>) {
  return (
    <div className={`fl-seg fh-flex${variant ? ` ${variant}` : ''}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" className={option.value === value ? 'on' : undefined} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface FhStepperProps {
  label: string;
  text: string;
  decreaseLabel: string;
  increaseLabel: string;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  small?: boolean;
  /** 아이콘을 기본 -/+ 대신 직접 지정 */
  decreaseIcon?: ReactNode;
  increaseIcon?: ReactNode;
}

export function FhStepper({
  label, text, decreaseLabel, increaseLabel, decreaseDisabled, increaseDisabled, onDecrease, onIncrease, small, decreaseIcon, increaseIcon,
}: FhStepperProps) {
  return (
    <div className={small ? 'fh-stepper sm' : 'fh-stepper'} role="group" aria-label={label}>
      <button type="button" aria-label={decreaseLabel} disabled={decreaseDisabled} onClick={onDecrease}>{decreaseIcon ?? <Minus size={20} aria-hidden="true" />}</button>
      <b>{text}</b>
      <button type="button" aria-label={increaseLabel} disabled={increaseDisabled} onClick={onIncrease}>{increaseIcon ?? <Plus size={20} aria-hidden="true" />}</button>
    </div>
  );
}

interface FhToggleRowProps {
  icon: ReactNode;
  title: string;
  sub: string;
  checked: boolean;
  onToggle: () => void;
}

export function FhToggleRow({ icon, title, sub, checked, onToggle }: FhToggleRowProps) {
  return (
    <button type="button" className="fl-row fh-tog" role="switch" aria-checked={checked} onClick={onToggle}>
      {icon}
      <span className="tx"><b>{title}</b><span>{sub}</span></span>
      <span className="sw" aria-hidden="true" />
    </button>
  );
}

/** 읽기 전용 안내 행(점선 테두리) */
export function FhStaticRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="fl-row fh-static">
      {icon}
      <span className="tx">{children}</span>
    </div>
  );
}
