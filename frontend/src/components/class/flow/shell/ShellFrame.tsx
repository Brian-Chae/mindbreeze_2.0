// SDD-209 SH1 — 셸형 하니스 프레임(사이드 메뉴 + 하단 탭바). 하니스(/design/class-flow)에서만 쓴다.
// 실제 앱은 AppShell/ClientShell 이 같은 자리를 그리므로 페이지 본문 뷰만 이 프레임 안에 그대로 올라간다.
import type { ReactNode } from 'react';
import { Bell, Calendar, ChevronLeft, Ellipsis, FileText, House, MessageCircle, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
import './shell-kit.css';

export type ShellRole = 'member' | 'host';
export type ShellActive = 'home' | 'class';

interface NavEntry { key: string; label: string; icon: LucideIcon }

const MEMBER_NAV: readonly NavEntry[] = [
  { key: 'home', label: '홈', icon: House },
  { key: 'class', label: '클래스', icon: Calendar },
  { key: 'chat', label: '채팅', icon: MessageCircle },
  { key: 'report', label: '리포트', icon: FileText },
  { key: 'more', label: '더보기', icon: Ellipsis },
];

const HOST_SIDE: readonly NavEntry[] = [
  { key: 'home', label: '대시보드', icon: House },
  { key: 'class', label: '클래스', icon: Calendar },
  { key: 'client', label: '내담자', icon: Users },
  { key: 'chat', label: '채팅', icon: MessageCircle },
  { key: 'report', label: '리포트', icon: FileText },
  { key: 'alarm', label: '알림', icon: Bell },
  { key: 'setting', label: '설정', icon: SlidersHorizontal },
];

const HOST_TABS: readonly NavEntry[] = HOST_SIDE.slice(0, 5);

interface ShellFrameProps {
  role: ShellRole;
  active: ShellActive;
  head: ReactNode;
  /** 스크롤 본문(sh-col 안) */
  children: ReactNode;
  /** 스크롤 밖 고정 푸터 */
  foot?: ReactNode;
  /** 시트·배너 등 프레임 위 덮개 */
  over?: ReactNode;
  /** 본문을 스크롤시키지 않고 자식이 높이를 나눠 쓴다(목록 화면) */
  hold?: boolean;
}

export function ShellFrame({ role, active, head, children, foot, over, hold = false }: ShellFrameProps) {
  const side = role === 'member' ? MEMBER_NAV : HOST_SIDE;
  const tabs = role === 'member' ? MEMBER_NAV : HOST_TABS;
  return (
    <div className="sh-scope sh-root" data-kind="shell" data-role={role}>
      <aside className="sh-side" aria-label="메뉴">
        <div className="sh-side__brand">Mind Breeze</div>
        <nav className="sh-nav">
          {side.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" className="sh-nav__item" aria-current={key === active ? 'page' : undefined}>
              <Icon size={20} aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
        <div className="sh-side__me">
          <b>{role === 'member' ? '지은 님' : '이서윤 상담사'}</b>
          <span>{role === 'member' ? '내담자' : '상담사 전용'}</span>
        </div>
      </aside>
      <main className="sh-main">
        {head}
        <div className="sh-scroll" style={hold ? { overflow: 'hidden', display: 'flex', flexDirection: 'column' } : undefined}>
          <div className="sh-col" style={hold ? { flex: 1, minHeight: 0 } : undefined}>{children}</div>
        </div>
        {foot}
        <nav className="sh-tabbar" aria-label="하단 메뉴">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" className="sh-tabbar__item" aria-current={key === active ? 'page' : undefined}>
              <Icon size={20} aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
      </main>
      {over}
    </div>
  );
}

/** 홈형 머리: 큰 제목 + 오른쪽 슬롯 */
export function ShellHeadTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="sh-head">
      <div className="sh-head__in">
        <h1 className="sh-title">{title}</h1>
        {right}
      </div>
    </header>
  );
}

/** 상세형 머리: 뒤로 + 가운데 제목 + 오른쪽 슬롯(없으면 빈 자리) */
export function ShellHeadBack({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="sh-head">
      <div className="sh-head3">
        <button type="button" className="sh-iconbtn" aria-label="뒤로" onClick={onBack}><ChevronLeft size={20} aria-hidden="true" /></button>
        <h1 className="sh-htitle">{title}</h1>
        {right ?? <span className="sh-ph" aria-hidden="true" />}
      </div>
    </header>
  );
}
