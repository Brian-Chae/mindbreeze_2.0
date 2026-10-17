// SDD-209 SH4 — 셸형 안내 박스·준비물 아이콘 표(문구 파생이 고른 이름 → lucide 아이콘). 글자 기호는 쓰지 않는다.
import {
  Activity, Bell, Calendar, CalendarX, CircleCheck, Clock, FileText, Headphones, MapPin, Moon, Phone, Send, Users, type LucideIcon,
} from 'lucide-react';
import type { HeroBoxIcon, PrepIcon } from '../../../../lib/class/enter-action';

export const BOX_ICONS: Readonly<Record<HeroBoxIcon, LucideIcon>> = {
  bell: Bell, clock: Clock, check: CircleCheck, activity: Activity, send: Send, 'calendar-x': CalendarX,
};

export const PREP_ICONS: Readonly<Record<PrepIcon, LucideIcon>> = {
  moon: Moon, headphones: Headphones, activity: Activity, phone: Phone, 'map-pin': MapPin, clock: Clock, 'file-text': FileText,
  users: Users, 'calendar-x': CalendarX, bell: Bell, calendar: Calendar,
};
