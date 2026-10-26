import { useId } from 'react';
interface SettingsSwitchProps {
  checked: boolean | 'mixed';
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** 혼합값은 저장하지 않고 가운데 손잡이와 명시적인 상태 설명으로 알린다. */
export function SettingsSwitch({ checked, onChange, label, disabled = false }: SettingsSwitchProps) {
  const stateId = useId();
  const mixed = checked === 'mixed';
  const state = mixed ? '일부' : checked ? '켜짐' : '꺼짐';
  return <button type="button" role="switch" aria-checked={checked === true} aria-label={label} aria-describedby={stateId} disabled={disabled} onClick={() => onChange(checked !== true)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B98AD9] disabled:cursor-wait disabled:opacity-50">
    <span data-switch-track aria-hidden="true" className="relative inline-block h-8 w-[52px] rounded-full shadow-inner" style={{ background: mixed ? '#C9A9DE' : checked ? 'linear-gradient(135deg,#7A2DB0,#5B1A8A)' : '#DDD6E1' }}>
      <span className="absolute left-[3px] top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow transition-transform" style={{ transform: `translateX(${mixed ? 10 : checked ? 20 : 0}px)` }} />
    </span>
    <span id={stateId} className="min-w-7 text-right text-[13px] text-[#776D7B]">{state}</span>
  </button>;
}
