import { useState, useEffect, type ReactNode } from 'react';
import SidebarNav, { ICONS, StrokeIcon } from './SidebarNav';
import MobileDrawer from './MobileDrawer';
import BottomTabBar from './BottomTabBar';
import { getUnreadCount } from '../../lib/api/notifications';

export interface AppShellProps {
  children: ReactNode;
  title: string;
  sub?: string;
  rightSlot?: ReactNode;
  contentPad?: string;
  noScroll?: boolean;
  noBottomPad?: boolean;
  hideBottomTab?: boolean;
}

export default function AppShell({
  children,
  title,
  sub,
  rightSlot,
  contentPad = 'px-4 py-4 md:px-8 md:py-6',
  noScroll = false,
  noBottomPad = false,
  hideBottomTab = false,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const poll = () => {
      getUnreadCount()
        .then((r) => setUnread(r.unread))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-screen w-full bg-white font-sans text-[#1F1F1F] md:grid md:grid-cols-[240px_1fr] flex flex-col">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex bg-[#F5EDFC] border-r border-[#EFEFEF] flex-col">
        <SidebarNav />
      </aside>

      {/* 모바일 헤더 */}
      <header className="md:hidden h-14 flex items-center justify-between px-4 border-b border-[#EFEFEF] bg-white shrink-0">
        <button
          type="button"
          aria-label="메뉴 열기"
          onClick={() => setDrawerOpen(true)}
          className="w-10 h-10 flex items-center justify-center -ml-2 text-[#1F1F1F]"
        >
          <StrokeIcon d={ICONS.hamburger} size={22} />
        </button>
        <div className="flex items-center gap-2">
          <img
            src="/mb-design/assets/logo_symbol_dark.svg"
            width={24}
            height={11}
            alt=""
          />
          <span className="font-extrabold text-[15px] text-[#5F0080] tracking-tight">
            mind&nbsp;breeze
          </span>
        </div>
        <button
          type="button"
          aria-label="알림"
          className="w-10 h-10 flex items-center justify-center -mr-2 text-[#1F1F1F] relative"
        >
          <StrokeIcon d={ICONS.bell} size={22} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </header>

      <section className="flex flex-col md:overflow-hidden flex-1 min-w-0">
        {/* 데스크톱 헤더 */}
        <header className="hidden md:flex h-[76px] px-8 items-center justify-between border-b border-[#EFEFEF] shrink-0">
          <div>
            {sub && (
              <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                {sub}
              </div>
            )}
            <div className="font-bold text-[22px] text-[#1F1F1F] tracking-tight mt-0.5">
              {title}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {rightSlot}
            <button
              type="button"
              aria-label="알림"
              className="w-11 h-11 rounded-full bg-[#F2F3F8] flex items-center justify-center text-[#1F1F1F] hover:bg-[#E6E7EE] transition-colors relative"
            >
              <StrokeIcon d={ICONS.bell} />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* 모바일 페이지 타이틀 */}
        {(title || sub || rightSlot) && (
          <div className="md:hidden px-4 pt-4 pb-2 flex items-end justify-between gap-3">
            <div className="min-w-0">
              {sub && (
                <div className="text-[11px] text-[#6F6F6F] font-mono uppercase tracking-wider">
                  {sub}
                </div>
              )}
              <div className="font-bold text-[18px] text-[#1F1F1F] tracking-tight mt-0.5 truncate">
                {title}
              </div>
            </div>
            {rightSlot && <div className="flex items-center gap-2 shrink-0">{rightSlot}</div>}
          </div>
        )}

        <div
          className={`flex-1 bg-white ${noScroll ? 'overflow-hidden' : 'overflow-auto'} ${contentPad} ${noBottomPad ? '' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]'} md:pb-0`}
        >
          {children}
        </div>
      </section>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {!hideBottomTab && <BottomTabBar onMoreClick={() => setDrawerOpen(true)} />}
    </div>
  );
}
