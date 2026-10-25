import { Children, Fragment, cloneElement, isValidElement, type ReactNode, type CSSProperties } from 'react';
import { headerButtonClass } from './styles';
import './page-header.css';


type ActionProps = { children?: ReactNode; className?: string; to?: string; href?: string; style?: CSSProperties; 'data-header-action'?: string };
function textOf(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<ActionProps>(child) ? textOf(child.props.children) : '').join('');
}
/** 호출자가 소유하는 링크·핸들러·권한 분기를 유지하며 헤더 액션만 공용 토큰으로 연결한다. */
function actionsOf(nodes: ReactNode): ReactNode {
  const normalize = (items: ReactNode): ReactNode[] => Children.toArray(items).flatMap(child => {
    if (!isValidElement<ActionProps>(child)) return [child];
    const text = textOf(child.props.children).trim();
    const interactive = child.type === 'button' || child.type === 'a' || !!child.props.to;
    if (interactive && !text) return [child];
    if (interactive) {
      const primary = child.props['data-header-action'] === 'primary';
      return [cloneElement(child, { className: headerButtonClass(primary), 'data-header-action': primary ? 'primary' : 'secondary' })];
    }
    if (child.type === Fragment) return normalize(child.props.children);
    if (typeof child.type === 'string' && child.props.children) return [cloneElement(child, { style: { ...child.props.style, display: 'contents' }, children: actionsOf(child.props.children) })];
    return [child];
  });
  return normalize(nodes).sort((left, right) => Number(isValidElement<ActionProps>(left) && left.props['data-header-action'] === 'primary') - Number(isValidElement<ActionProps>(right) && right.props['data-header-action'] === 'primary'));
}

export interface PageHeaderProps {
  title: ReactNode;
  sub?: ReactNode;
  overline?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2;
  mobile?: boolean;
  className?: string;
}
export function PageHeader({ title, sub, overline, actions, level = 1, mobile = false, className = '' }: PageHeaderProps) {
  const Tag = level === 1 ? 'h1' : 'h2';
  return <div data-ui="page-header" className={`mb-page-header ${mobile ? 'mb-page-header-mobile' : ''} ${overline || sub ? 'mb-page-header-with-overline' : ''} ${className}`}>
    <div className="mb-page-header-title">
      {(overline || sub) && <div className="mb-page-header-overline text-[13px] text-[#6F6F6F]">{overline || sub}</div>}
      <Tag data-mobile-swipe-title={mobile ? '' : undefined} tabIndex={mobile ? -1 : undefined} className="text-[22px] font-bold leading-[30px] text-[#1F1F1F] md:leading-[33px]">{title}</Tag>
    </div>
    {actions && <div data-ui="header-actions" className="mb-page-header-actions">{actionsOf(actions)}</div>}
  </div>;
}
