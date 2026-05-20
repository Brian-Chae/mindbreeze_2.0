import { NavLink } from 'react-router-dom';
import { ICONS, StrokeIcon } from './SidebarNav';

interface TabItem {
  to: string;
  label: string;
  icon: string[];
}

const TAB_ITEMS: TabItem[] = [
  { to: '/dashboard', label: '홈', icon: ICONS.home },
  { to: '/sessions', label: '세션', icon: ICONS.calendar },
  { to: '/chat', label: '채팅', icon: ICONS.message },
  { to: '/reports', label: '리포트', icon: ICONS.report },
];

interface BottomTabBarProps {
  onMoreClick: () => void;
}

export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#EFEFEF] flex items-stretch justify-around"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TAB_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `relative flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-[11px] flex-1 h-14 ${
              isActive ? 'text-[#5F0080] font-semibold' : 'text-[#6F6F6F]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[#5F0080]" />
              )}
              <StrokeIcon d={item.icon} size={22} />
              <span>{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onMoreClick}
        className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-[11px] flex-1 h-14 text-[#6F6F6F]"
      >
        <StrokeIcon d={ICONS.menu} size={22} />
        <span>더보기</span>
      </button>
    </nav>
  );
}
