import { Link, useLocation } from 'react-router-dom';
import { ICONS } from './SidebarNav';
import './floating-bottom-nav.css';

export interface FloatingTab {
  to: string;
  label: string;
  icon: string[];
  badge?: number;
}

/** 경로는 가장 구체적인 탭 하나만 활성화한다. 나머지 경로는 더보기로 연결한다. */
export function FloatingBottomNav({ tabs, moreBadge = 0, onMoreClick }: { tabs: FloatingTab[]; moreBadge?: number; onMoreClick: () => void }) {
  const { pathname } = useLocation();
  const activePath = tabs.filter(({ to }) => pathname === to.split('?')[0] || (to !== '/app' && pathname.startsWith(`${to.split('?')[0]}/`))).sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const content = (label: string, icon: string[], active: boolean, badge = 0) => <>
    <span className="floating-bottom-nav__icon"><svg width="23" height="23" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon.map((d, i) => <path key={i} d={d} />)}</svg>{badge > 0 && <span className="floating-bottom-nav__badge" aria-hidden="true">{badge > 9 ? '9+' : badge}</span>}</span>
    <span>{label}</span>
  </>;
  return <nav aria-label="하단 메뉴" className="floating-bottom-nav md:hidden">
    {tabs.map(tab => <Link className="flex-1" key={tab.to} to={tab.to} aria-label={tab.badge ? `${tab.label} ${tab.badge}건` : tab.label} aria-current={activePath === tab.to ? 'page' : undefined}>{content(tab.label, tab.icon, activePath === tab.to, tab.badge)}</Link>)}
    <button className="flex-1" type="button" onClick={onMoreClick} aria-label={moreBadge ? `더보기 ${moreBadge}건` : '더보기'} aria-current={!activePath ? 'page' : undefined}>{content('더보기', ICONS.menu, !activePath, moreBadge)}</button>
  </nav>;
}
