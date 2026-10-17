// SDD-209 SH1 — 상태 배지. 색 + 선 + 아이콘 + 라벨을 함께 쓴다(색만으로 구분하지 않는다).
import { Calendar, CircleCheck, CirclePlay, CircleX, Clock, LogIn, Mail, type LucideIcon } from 'lucide-react';
import { CLASS_CHIP_LABELS, type ClassChipKey } from '../../../../lib/class/class-labels';
import './shell-kit.css';

export type ChipTone = 'brand' | 'mute' | 'ok' | 'live' | 'warn' | 'dash' | 'line';

const CHIP_ICONS: Readonly<Record<ClassChipKey, LucideIcon>> = {
  ready: Clock,
  scheduled: Calendar,
  soon: Clock,
  open: LogIn,
  live: CirclePlay,
  done: CircleCheck,
  cancelled: CircleX,
  invited: Mail,
};

/** 회원 화면 기본 색. 상담사 화면은 tone 으로 예정(brand)·취소(warn)를 덮어쓴다 */
const DEFAULT_TONES: Readonly<Record<ClassChipKey, ChipTone>> = {
  ready: 'mute',
  scheduled: 'mute',
  soon: 'brand',
  open: 'ok',
  live: 'live',
  done: 'mute',
  cancelled: 'dash',
  invited: 'line',
};

/** brand 는 기본 보라 칩, 나머지는 같은 이름의 변형 클래스 */
function toneClass(tone: ChipTone): string {
  return tone === 'brand' ? '' : ` ${tone}`;
}

interface StatusChipProps {
  chip: ClassChipKey;
  /** 사진 위(어두운 면)에 올리는 칩 */
  dark?: boolean;
  tone?: ChipTone;
}

export function StatusChip({ chip, dark = false, tone }: StatusChipProps) {
  const Icon = CHIP_ICONS[chip];
  const resolved = tone ?? DEFAULT_TONES[chip];
  const base = dark ? 'sh-hchip' : 'sh-chip';
  return (
    <span className={`${base}${toneClass(resolved)}`} data-chip={chip}>
      <Icon size={16} aria-hidden="true" />
      {CLASS_CHIP_LABELS[chip]}
    </span>
  );
}
