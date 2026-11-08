// SDD-320 F — 회원 PC 좌측 메뉴(시안 member-pc). 기존 SidebarNav 마크업은 건드리지 않고 ui-v2 전용으로 새로 만든다.
// 항목·링크·배지는 SidebarNav 의 회원 메뉴와 같고, 라벨만 시안(대화)을 따른다. 서버 연결 표시는 기존 기능이라 하단에 작게 유지한다.
import { NavLink, useNavigate } from 'react-router-dom';
import { ICONS, StrokeIcon } from '../layout/SidebarNav';
import { loginPathForRole } from '../../lib/auth-routing';
import { isCounselingEnabled } from '../../lib/feature-flags';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';

export interface UiV2MemberSidebarProps {
  notificationBadge: number;
  chatBadge: number;
  reportBadge: number;
  sessionBadge: number;
}

interface MemberNavItem { to: string; label: string; icon: string[]; end?: boolean; badge: number }

export function buildMemberNavItems(p: UiV2MemberSidebarProps, counselingOpen: boolean): MemberNavItem[] {
  const items: MemberNavItem[] = [
    { to: '/app', label: '홈', icon: ICONS.home, end: true, badge: 0 },
    { to: '/app/classes', label: '내 클래스', icon: ICONS.calendar, badge: 0 },
    { to: '/app/counseling', label: '내 상담', icon: ICONS.users, badge: 0 },
    { to: '/app/chat', label: '대화', icon: ICONS.message, badge: p.chatBadge },
    { to: '/app/reports', label: '리포트', icon: ICONS.report, badge: p.reportBadge },
    { to: '/app/notifications', label: '알림', icon: ICONS.bell, badge: Math.max(p.notificationBadge, p.sessionBadge) },
    { to: '/app/profile', label: '설정', icon: ICONS.settings, badge: 0 },
  ];
  return counselingOpen ? items : items.filter((item) => item.to !== '/app/counseling');
}

export function UiV2MemberSidebar(props: UiV2MemberSidebarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const connected = useNotificationStore((s) => s.wsConnected);
  const items = buildMemberNavItems(props, isCounselingEnabled());
  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate(loginPathForRole(user?.role));
  };
  return (
    <div data-sidebar-root className="u2-side" data-ui-v2-side="member">
      <NavLink to="/app" className="u2-side-logo" aria-label="MIND BREEZE 홈">
        <img src="/mb-design/assets/logo_symbol_dark.svg" width={28} height={13} alt="" />
        <b>MIND&nbsp;BREEZE</b>
      </NavLink>
      <nav data-sidebar-menu aria-label="회원 메뉴" className="u2-side-menu">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="u2-side-item" aria-label={item.badge > 0 ? `${item.label} ${item.badge}건` : undefined}>
            <StrokeIcon d={item.icon} size={22} />
            <span>{item.label}</span>
            {item.badge > 0 && <em className="u2-side-badge" aria-hidden="true">{item.badge > 9 ? '9+' : item.badge}</em>}
          </NavLink>
        ))}
      </nav>
      <div data-sidebar-profile className="u2-side-foot">
        <strong>{user?.name ?? '회원'}</strong>
        <small>{user?.email ?? ''}</small>
        <button type="button" onClick={() => void handleLogout()}>로그아웃</button>
        <p className="u2-side-conn"><i data-on={connected || undefined} aria-hidden="true" />서버연결: {connected ? '양호' : '끊김'}</p>
      </div>
    </div>
  );
}
