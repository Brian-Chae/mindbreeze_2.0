import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import SidebarNav, { ICONS, StrokeIcon } from './SidebarNav';
import MobileDrawer from './MobileDrawer';
import BottomTabBar from './BottomTabBar';
import { useNotificationStore } from '../../stores/notificationStore';
import { useChatStore } from '../../stores/chatStore';
import { useNotificationSocket } from '../../hooks/useNotificationSocket';
import { listChatRooms } from '../../lib/api/chat';

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
  const navigate = useNavigate();
  const unread = useNotificationStore((s) => s.unread);
  const toast = useNotificationStore((s) => s.toast);
  const dismissToast = useNotificationStore((s) => s.dismissToast);
  const chatUnread = useChatStore((s) =>
    s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0),
  );

  // Socket.IO 실시간 알림 리스너 + 최초 fetch
  useNotificationSocket();

  // 채팅방 목록 불러오기 (사이드바 뱃지용)
  const setRooms = useChatStore((s) => s.setRooms);
  useEffect(() => {
    listChatRooms()
      .then((res) => setRooms(res.rooms))
      .catch(() => { /* 조용히 실패 */ });
  }, [setRooms]);

  const handleToastClick = () => {
    if (toast?.roomId) {
      navigate(`/chat?room=${toast.roomId}`);
    }
    dismissToast();
  };

  const handleBellClick = () => {
    navigate('/notifications');
  };

  return (
    <div className="h-full w-full bg-white font-sans text-[#1F1F1F] md:grid md:grid-cols-[240px_1fr] flex flex-col">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex bg-[#F5EDFC] border-r border-[#EFEFEF] flex-col">
        <SidebarNav notificationBadge={unread} chatBadge={chatUnread} />
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
            Mind&nbsp;Breeze
          </span>
        </div>
        <button
          type="button"
          aria-label="알림"
          onClick={handleBellClick}
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

      <section className="flex flex-col flex-1 min-w-0 min-h-0">
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
          <div className="flex items-center gap-3 relative">
            {rightSlot}
            <button
              type="button"
              aria-label="알림"
              onClick={handleBellClick}
              className="w-11 h-11 rounded-full bg-[#F2F3F8] flex items-center justify-center text-[#1F1F1F] hover:bg-[#E6E7EE] transition-colors relative"
            >
              <StrokeIcon d={ICONS.bell} />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {/* 토스트 팝업 */}
            {toast && (
              <button
                type="button"
                onClick={handleToastClick}
                className="absolute top-full right-0 mt-2 w-72 bg-[#F5EDFC] border border-[#DDD0EA] rounded-xl shadow-lg shadow-[#5F0080]/10 p-3.5 z-50 text-left hover:bg-[#EFE3FA] hover:border-[#C9B0E8] transition-all cursor-pointer overflow-hidden"
              >
                {/* 왼쪽 악센트 바 */}
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#5F0080] rounded-l-xl" />
                <div className="flex items-start gap-3 pl-1">
                  {/* 알림 아이콘 */}
                  <div className="shrink-0 w-8 h-8 rounded-lg bg-[#5F0080]/10 flex items-center justify-center mt-0.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5F0080" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-[#1F1F1F] truncate pr-5">
                      {toast.title}
                    </div>
                    <div className="text-[12px] text-[#6F6F6F] mt-0.5 line-clamp-2">
                      {toast.body}
                    </div>
                  </div>
                </div>
                {/* 닫기 버튼 */}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); dismissToast(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); dismissToast(); } }}
                  className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#DDD0EA]/50 flex items-center justify-center text-[#6E1A8C] hover:bg-[#DDD0EA] hover:text-[#5F0080] text-[10px] transition-colors"
                >
                  ✕
                </span>
              </button>
            )}
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
          className={`flex-1 min-h-0 bg-white ${noScroll ? '' : 'overflow-auto'} ${contentPad} ${noBottomPad ? '' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]'} md:pb-0`}
        >
          {children}
        </div>
      </section>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {!hideBottomTab && <BottomTabBar onMoreClick={() => setDrawerOpen(true)} />}
    </div>
  );
}
