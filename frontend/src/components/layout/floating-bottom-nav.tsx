import { Link, useLocation } from 'react-router-dom';
import './floating-bottom-nav.css';

export interface FloatingTab {
  to: string;
  label: string;
  icon: string[];
  badge?: number;
}

/** 경로는 가장 구체적인 탭 하나만 활성화한다. 일치하지 않는 업무 경로는 설정을 활성화하지 않는다. */
export function FloatingBottomNav({ tabs }: { tabs: FloatingTab[] }) {
  const { pathname } = useLocation();
  const activePath = tabs.filter(({ to }) => pathname === to.split('?')[0] || (to !== '/app' && pathname.startsWith(`${to.split('?')[0]}/`))).sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const content = (label: string, icon: string[], active: boolean, badge = 0) => <>
    <span className="floating-bottom-nav__icon"><svg width="23" height="23" viewBox="0 0 24 24" fill={active && label !== '설정' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon.map((d, i) => <path key={i} d={d} />)}</svg>{badge > 0 && <span className="floating-bottom-nav__badge" aria-hidden="true">{badge > 9 ? '9+' : badge}</span>}</span>
    <span>{label}</span>
  </>;
  return <nav aria-label="하단 메뉴" className="floating-bottom-nav md:hidden">
    {tabs.map(tab => <Link className="flex-1" key={tab.to} to={tab.to} aria-label={tab.badge ? `${tab.label} ${tab.badge}건` : tab.label} aria-current={activePath === tab.to ? 'page' : undefined}>{content(tab.label, tab.icon, activePath === tab.to, tab.badge)}</Link>)}
  </nav>;
}
