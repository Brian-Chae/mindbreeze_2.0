// SDD-245: 공용 UI 클래스 생성기(컴포넌트·링크·기존 요소 공용). 값은 design-system/tokens의 page/button/card/input 토큰과 같다.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonTone = 'default' | 'inverse' | 'danger';

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tone?: ButtonTone;
  className?: string;
}

const BASE = 'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

// 높이: 모바일 48 / 데스크톱 44 (lg는 항상 48). sm은 터치 최소 44.
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-11 min-h-11 px-3 text-[14px] md:text-[14px]',
  md: 'h-12 px-4 text-[14px] md:h-11 md:text-[15px]',
  lg: 'h-12 px-6 text-[15px]',
};

const VARIANT: Record<Exclude<ButtonVariant, 'icon'>, Record<ButtonTone, string>> = {
  primary: {
    default: 'rounded-full bg-[#5F0080] text-white hover:bg-[#4B0066]',
    inverse: 'rounded-full bg-white text-[#5F0080] hover:bg-[#F4EDF8]',
    danger: 'rounded-full bg-[#B3264B] text-white hover:bg-[#962041]',
  },
  secondary: {
    default: 'rounded-xl bg-[#F4EDF8] text-[#5F0080] hover:bg-[#EADFF2]',
    inverse: 'rounded-xl bg-white/15 text-white hover:bg-white/25',
    danger: 'rounded-xl bg-[#FDECEF] text-[#B3264B] hover:bg-[#FAD9E0]',
  },
  ghost: {
    default: 'rounded-xl bg-transparent text-[#5F0080] hover:bg-[#F4EDF8]',
    inverse: 'rounded-xl bg-transparent text-white hover:bg-white/15',
    danger: 'rounded-xl bg-transparent text-[#B3264B] hover:bg-[#FDECEF]',
  },
};

const ICON = 'h-11 w-11 shrink-0 rounded-full bg-[#F2F3F8] text-[#1F1F1F] hover:bg-[#E6E7EF]';

/** 버튼/링크 공용 클래스 생성기. icon은 size를 무시하고 44×44를 쓴다. */
export function buttonClass({ variant = 'primary', size = 'md', tone = 'default', className }: ButtonStyleOptions = {}): string {
  const parts = variant === 'icon'
    ? [BASE, ICON]
    : [BASE, SIZE[size], VARIANT[variant][tone]];
  if (className) parts.push(className);
  return parts.join(' ');
}


export type CardPadding = 'default' | 'compact' | 'none';

const PADDING: Record<CardPadding, string> = {
  default: 'p-6',
  compact: 'p-4',
  none: 'p-0',
};

export function cardClass(padding: CardPadding = 'default', className?: string): string {
  const parts = ['min-w-0 rounded-[20px] border border-[#E8E2ED] bg-white shadow-[0_2px_8px_rgba(53,33,63,0.024)]', PADDING[padding]];
  if (className) parts.push(className);
  return parts.join(' ');
}


// 테두리 #857E8F는 흰 배경 대비 3:1 이상(컨트롤 경계 AA). 모바일 48 / 데스크톱 44.
const FIELD = 'w-full rounded-xl border border-[#857E8F] bg-white px-4 text-base text-[#1F1F1F] placeholder:text-[#6F6F6F] focus-visible:border-[#5F0080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080]/40 disabled:cursor-not-allowed disabled:bg-[#F2F3F8] disabled:opacity-70 md:text-[15px]';
const HEIGHT = 'h-12 md:h-11';

export function fieldClass(kind: 'input' | 'select' | 'textarea' = 'input', className?: string): string {
  const parts = [FIELD, kind === 'textarea' ? 'min-h-24 py-3' : HEIGHT];
  if (className) parts.push(className);
  return parts.join(' ');
}


// SDD-245: 탭·칩 스타일 계약. 키보드/role 동작은 호출 쪽 기존 구현을 그대로 쓴다.
export function tabClass(active: boolean, className?: string): string {
  const parts = [
    'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors md:text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080]',
    active ? 'bg-[#5F0080] text-white' : 'bg-transparent text-[#5F0080] hover:bg-[#F4EDF8]',
  ];
  if (className) parts.push(className);
  return parts.join(' ');
}

/** 비조작 칩. 클릭 가능한 칩은 buttonClass(size="sm")를 쓴다. */
export function chipClass(className?: string): string {
  const parts = ['inline-flex min-h-7 items-center rounded-full bg-[#F1EDF5] px-2.5 text-[13px] font-semibold text-[#655173]'];
  if (className) parts.push(className);
  return parts.join(' ');
}

export function headerButtonClass(primary = false): string {
  return buttonClass({ variant: 'primary', tone: primary ? 'default' : 'inverse', size: 'sm', className: `mb-header-action ${primary ? 'border border-transparent' : 'border border-[#5F0080]'}` });
}
