// SDD-208 — 상담사 시트 공용 조각: 스위치·줄(row)·섹션·이니셜 아바타. 시트 안에서만 쓴다.
import type { ReactNode } from 'react';
import './host-player.css';

interface HostSwitchProps {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function HostSwitch({ checked, label, onChange, disabled }: HostSwitchProps) {
  return (
    <button type="button" role="switch" className="hp-sw" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="hp-sw__trk" />
    </button>
  );
}

interface HostRowProps {
  lead?: ReactNode;
  title: string;
  sub?: ReactNode;
  subTone?: 'coral' | 'caution';
  trailing?: ReactNode;
}

export function HostRow({ lead, title, sub, subTone, trailing }: HostRowProps) {
  return (
    <div className="hp-row">
      <div className="hp-row__l">
        {lead}
        <div className="hp-row__tx">
          <b>{title}</b>
          {sub ? <small data-tone={subTone}>{sub}</small> : null}
        </div>
      </div>
      {trailing}
    </div>
  );
}

export function HostSection({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="hp-sec">
      {label ? <p className="hp-lbl">{label}</p> : null}
      {children}
    </div>
  );
}

export function HostAvatar({ name }: { name: string }) {
  return <span className="hp-av" aria-hidden="true">{name.slice(0, 1)}</span>;
}
