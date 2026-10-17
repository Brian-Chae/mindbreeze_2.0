// SDD-209 SH4 — 셸형 안내 박스·준비물 아이콘 표(문구 파생이 고른 이름 → lucide 아이콘). 글자 기호는 쓰지 않는다.
import {
  Activity, Bell, Calendar, CalendarX, CircleCheck, Clock, FileText, Headphones, Heart, Leaf, MapPin, Moon, Phone, Send, Sparkles, Users, type LucideIcon,
} from 'lucide-react';
import type { ClassChipKey } from '../../../../lib/class/class-labels';
import type { HeroBoxIcon, PrepIcon } from '../../../../lib/class/enter-action';
import type { HostItemIcon } from './host-shell-data';
import type { ChipTone } from './StatusChip';

export const BOX_ICONS: Readonly<Record<HeroBoxIcon, LucideIcon>> = {
  bell: Bell, clock: Clock, check: CircleCheck, activity: Activity, send: Send, 'calendar-x': CalendarX,
};

export const PREP_ICONS: Readonly<Record<PrepIcon, LucideIcon>> = {
  moon: Moon, headphones: Headphones, activity: Activity, phone: Phone, 'map-pin': MapPin, clock: Clock, 'file-text': FileText,
  users: Users, 'calendar-x': CalendarX, bell: Bell, calendar: Calendar,
};

/** 상담사 화면의 배지 색: 예정은 보라, 취소는 경고(점선) — 회원 화면 기본과 다르다 */
export const HOST_CHIP_TONES: Readonly<Partial<Record<ClassChipKey, ChipTone>>> = {
  scheduled: 'brand',
  cancelled: 'warn',
};


export const HOST_ITEM_ICONS: Readonly<Record<HostItemIcon, LucideIcon>> = {
  heart: Heart, moon: Moon, leaf: Leaf, sparkles: Sparkles,
};
