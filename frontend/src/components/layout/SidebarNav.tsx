import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

interface NavItem {
  to: string;
  label: string;
  icon: string[];
  badge?: number;
}

export const ICONS = {
  home: ['M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z'],
  calendar: [
    'M8 2v4',
    'M16 2v4',
    'M3 9h18',
    'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  ],
  users: [
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M23 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  report: [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    'M14 2v6h6',
    'M9 13h6',
    'M9 17h4',
  ],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ],
  bell: [
    'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9',
    'M13.73 21a2 2 0 0 1-3.46 0',
  ],
  menu: [
    'M5 12h.01',
    'M12 12h.01',
    'M19 12h.01',
  ],
  hamburger: [
    'M3 6h18',
    'M3 12h18',
    'M3 18h18',
  ],
};

export function StrokeIcon({ d, size = 20 }: { d: string[]; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="block"
    >
      {d.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: '대시보드', icon: ICONS.home },
  { to: '/sessions', label: '세션', icon: ICONS.calendar },
  { to: '/clients', label: '내담자', icon: ICONS.users },
  { to: '/chat', label: '채팅', icon: ICONS.message },
  { to: '/reports', label: '리포트', icon: ICONS.report },
  { to: '/notifications', label: '알림', icon: ICONS.bell },
  { to: '/settings', label: '설정', icon: ICONS.settings },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { to: '/admin/reviews', label: '검토 큐', icon: ICONS.report },
  { to: '/admin/users', label: '사용자 관리', icon: ICONS.users },
];

interface SidebarNavProps {
  onNavigate?: () => void;
}

export default function SidebarNav({ onNavigate }: SidebarNavProps) {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex flex-col gap-7 px-5 py-8 h-full">
      <div className="flex items-center gap-2.5 px-2.5">
        <img
          src="/mb-design/assets/logo_symbol_dark.svg"
          width={28}
          height={13}
          alt=""
        />
        <span className="font-extrabold text-[17px] text-[#5F0080] tracking-tight">
          mind&nbsp;breeze
        </span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-3 rounded-xl text-[15px] text-left transition-colors ${
                isActive
                  ? 'bg-white text-[#5F0080] font-bold shadow-sm'
                  : 'bg-transparent text-[#1F1F1F] font-medium hover:bg-white/60'
              }`
            }
          >
            <StrokeIcon d={it.icon} />
            <span className="flex-1">{it.label}</span>
            {it.badge ? (
              <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#5F0080] text-white font-bold text-[10px] inline-flex items-center justify-center font-mono">
                {it.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {user?.role === 'platform_admin' && (
        <div className="mt-2 pt-4 border-t border-[#DDD0EA]">
          <div className="px-3.5 text-[11px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">
            어드민
          </div>
          {ADMIN_NAV_ITEMS.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-3 rounded-xl text-[15px] text-left transition-colors ${
                  isActive
                    ? 'bg-white text-[#5F0080] font-bold shadow-sm'
                    : 'bg-transparent text-[#1F1F1F] font-medium hover:bg-white/60'
                }`
              }
            >
              <StrokeIcon d={it.icon} />
              <span className="flex-1">{it.label}</span>
            </NavLink>
          ))}
        </div>
      )}

      <div className="mt-auto bg-white rounded-2xl p-4">
        <div className="text-[12px] text-[#6F6F6F] font-mono">상담사</div>
        <div className="font-bold text-[15px] text-[#1F1F1F] mt-1">
          {user?.name ?? '게스트'}
        </div>
        <div className="text-[12px] text-[#6F6F6F] mt-0.5">
          {user?.email ?? '계정 정보 없음'}
        </div>
      </div>
    </div>
  );
}
