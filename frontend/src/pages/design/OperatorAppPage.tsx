import { useState, createContext, useContext, type ReactNode } from 'react';

const ASSET = '/mb-design/assets';

type RouteId = 'signin' | 'dashboard' | 'session-running' | 'clients' | 'messages' | 'reports' | 'settings';
type ModalData = { kind?: 'confirm' | 'danger'; title: string; body: string; cancel?: string; confirm?: string } | null;

const NavCtx = createContext<{ route: RouteId; go: (r: RouteId) => void }>({ route: 'dashboard', go: () => {} });
const ModalCtx = createContext<{ open: (d: ModalData) => void; close: () => void }>({ open: () => {}, close: () => {} });
const useNav = () => useContext(NavCtx);
const useModal = () => useContext(ModalCtx);

const ICONS: Record<string, string[]> = {
  home: ['M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z'],
  calendar: ['M8 2v4', 'M16 2v4', 'M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  report: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M9 13h6', 'M9 17h4'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'],
  play: ['M5 3l14 9-14 9z'],
  pause: ['M6 4h4v16H6z', 'M14 4h4v16h-4z'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  send: ['m22 2-7 20-4-9-9-4 20-7Z'],
  attach: ['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
  more: ['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
};

function StrokeIcon({ d, size = 22, color = 'currentColor' }: { d: string[]; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

function StatusPill({ tone = 'muted', children, leading }: { tone?: 'primary' | 'soft' | 'danger' | 'ghost' | 'muted'; children: ReactNode; leading?: ReactNode }) {
  const tones = {
    primary: { bg: '#5F0080', color: '#FFFFFF' },
    soft: { bg: '#D2AEFC', color: '#5F0080' },
    danger: { bg: 'rgba(252,85,85,0.18)', color: '#D33F3F' },
    ghost: { bg: 'rgba(255,255,255,0.2)', color: '#FFFFFF' },
    muted: { bg: '#F5EDFC', color: '#5F0080' },
  }[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 14px', borderRadius: 18, background: tones.bg, color: tones.color, fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 13 }}>
      {leading}
      {children}
    </span>
  );
}

function AppShell({ children, title, sub, rightSlot, contentPad = '24px 32px', noScroll = false }: { children: ReactNode; title: string; sub?: string; rightSlot?: ReactNode; contentPad?: string; noScroll?: boolean }) {
  const { route, go } = useNav();
  const railItems = [
    { id: 'dashboard' as RouteId, label: '대시보드', icon: ICONS.home },
    { id: 'session-running' as RouteId, label: '수업 진행', icon: ICONS.calendar },
    { id: 'clients' as RouteId, label: '참여자', icon: ICONS.users },
    { id: 'messages' as RouteId, label: '메시지', icon: ICONS.message, badge: 3 },
    { id: 'reports' as RouteId, label: '리포트', icon: ICONS.report },
    { id: 'settings' as RouteId, label: '설정', icon: ICONS.settings },
  ];
  return (
    <div style={{ width: 1366, height: 1024, background: '#FFFFFF', display: 'grid', gridTemplateColumns: '240px 1fr', overflow: 'hidden', fontFamily: 'var(--mb-font-sans)', borderRadius: 24, border: '1px solid #DDDEE7' }}>
      <aside style={{ background: '#F5EDFC', padding: '32px 20px', display: 'flex', flexDirection: 'column', gap: 28, borderRight: '1px solid #EFEFEF' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px' }}>
          <img src={`${ASSET}/logo_symbol_dark.svg`} width="28" height="13" alt="" />
          <span style={{ fontWeight: 800, fontSize: 17, color: '#5F0080', letterSpacing: '-0.02em' }}>mind&nbsp;breeze</span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {railItems.map((it) => {
            const active = route === it.id;
            return (
              <button key={it.id} onClick={() => go(it.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, background: active ? '#FFFFFF' : 'transparent', border: 0, padding: '12px 14px', borderRadius: 12, color: active ? '#5F0080' : '#1F1F1F', fontFamily: 'var(--mb-font-sans)', fontWeight: active ? 700 : 500, fontSize: 15, cursor: 'pointer', textAlign: 'left', boxShadow: active ? '0 1px 1px rgba(25,26,30,0.06)' : 'none', position: 'relative' }}>
                <StrokeIcon d={it.icon} size={20} color={active ? '#5F0080' : '#1F1F1F'} />
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.badge && (
                  <span style={{ minWidth: 18, height: 18, padding: '0 6px', borderRadius: 9, background: '#5F0080', color: '#FFFFFF', fontFamily: 'var(--mb-font-mono)', fontWeight: 700, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{it.badge}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', background: '#FFFFFF', borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 12, color: '#6F6F6F', fontFamily: 'var(--mb-font-mono)' }}>지도사</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1F1F1F', marginTop: 4 }}>김지수</div>
          <div style={{ fontSize: 12, color: '#6F6F6F', marginTop: 2 }}>마인드브리즈 청담센터</div>
        </div>
      </aside>
      <section style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ height: 76, padding: '0 32px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #EFEFEF' }}>
          <div>
            {sub && <div style={{ fontSize: 12, color: '#6F6F6F', fontFamily: 'var(--mb-font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{sub}</div>}
            <div style={{ fontWeight: 700, fontSize: 22, color: '#1F1F1F', letterSpacing: '-0.012em', marginTop: 2 }}>{title}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {rightSlot}
            <button style={{ width: 44, height: 44, borderRadius: 22, background: '#F2F3F8', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StrokeIcon d={ICONS.bell} size={20} color="#1F1F1F" />
            </button>
          </div>
        </header>
        <div style={{ flex: 1, overflow: noScroll ? 'hidden' : 'auto', background: '#FFFFFF', padding: contentPad }}>{children}</div>
      </section>
    </div>
  );
}

function Dashboard() {
  const [day, setDay] = useState(21);
  const { go } = useNav();
  const dotsOn = new Set([2, 5, 9, 12, 15, 20, 21, 23]);
  const muted = [27, 28, 29, 30];
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const today = 20;
  const cells = [...muted.map((n) => ({ n, muted: true })), ...days.map((n) => ({ n, muted: false }))];

  const Day = ({ n, muted: m }: { n: number; muted: boolean }) => {
    const isToday = !m && n === today;
    const isSel = !m && n === day;
    const dot = !m && dotsOn.has(n);
    const fontWeight: 500 | 700 = isSel || isToday ? 700 : 500;
    return (
      <button onClick={() => !m && setDay(n)} style={{ aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-sans)', fontSize: 14, color: isSel ? '#FFFFFF' : isToday ? '#5F0080' : m ? '#C2C3CE' : '#1F1F1F', background: isSel ? '#5F0080' : isToday ? '#F5EDFC' : 'transparent', borderRadius: 10, border: 0, cursor: m ? 'default' : 'pointer', position: 'relative', fontWeight }}>
        {n}
        {dot && <span style={{ position: 'absolute', bottom: 5, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: isSel ? 'rgba(255,255,255,0.7)' : '#B373EF' }} />}
      </button>
    );
  };

  const sessions = [
    { time: '09:30', title: '아침 마음챙김 · 정기반', tag: '오프라인', count: 8 },
    { time: '14:00', title: '사내 워크숍 · 라온건강원', tag: '온라인', count: 14 },
    { time: '19:00', title: '바디스캔 입문 · 1:1', tag: '오프라인', count: 1 },
  ];
  const tagColor: Record<string, { bg: string; fg: string }> = {
    오프라인: { bg: '#F5EDFC', fg: '#5F0080' },
    온라인: { bg: '#E6F8F3', fg: '#1F8A5B' },
  };
  const activities = [
    { who: '김민지', what: '측정을 완료했습니다', when: '방금 전', tone: 'purple' },
    { who: '정수아', what: '리포트가 발급되었습니다', when: '12분 전', tone: 'green' },
    { who: '박서준', what: '세션 예약을 변경했습니다', when: '1시간 전', tone: 'orange' },
    { who: '이도윤', what: '프로그램을 일시 중지했습니다', when: '어제', tone: 'gray' },
  ];
  const dotColor: Record<string, string> = { purple: '#5F0080', green: '#1F8A5B', orange: '#E6593D', gray: '#A2A3AD' };

  const stats: Array<{ label: string; value: string; delta: string; tone: 'up' | 'down' | 'flat' }> = [
    { label: '이번 주 세션', value: '11', delta: '3', tone: 'up' },
    { label: '활동중 참여자', value: '42', delta: '5', tone: 'up' },
    { label: '평균 휴식도', value: '72', delta: '8', tone: 'up' },
    { label: '대기 리포트', value: '3', delta: '2', tone: 'down' },
  ];
  const toneArrow: Record<string, { c: string; a: string }> = {
    up: { c: '#1F8A5B', a: '↓' },
    down: { c: '#D33F3F', a: '↑' },
    flat: { c: '#6F6F6F', a: '·' },
  };

  return (
    <AppShell
      title="안녕하세요, 김지수 지도사님"
      sub="2026.05 · 5월 셋째 주"
      rightSlot={
        <button className="mb-btn" style={{ height: 44, padding: '0 18px', borderRadius: 22, display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={() => go('session-running')}>
          <StrokeIcon d={ICONS.play} size={16} color="#FFFFFF" />
          진행 중인 세션 열기
        </button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 20 }}>
        <div style={{ background: '#FFFFFF', border: '1px solid #DDDEE7', borderRadius: 20, padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.014em', color: '#1F1F1F' }}>2026년 5월</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['‹', '오늘', '›'].map((l, i) => (
                <button key={i} style={{ minWidth: 32, height: 32, padding: '0 10px', borderRadius: 10, border: 0, background: l === '오늘' ? '#5F0080' : '#F5EDFC', color: l === '오늘' ? '#FFFFFF' : '#5F0080', cursor: 'pointer', fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 13 }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
              <div key={d} style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', color: '#6F6F6F', padding: '4px 0' }}>{d}</div>
            ))}
            {cells.map((c, i) => <Day key={i} {...c} />)}
          </div>
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #DDDEE7', borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 17, color: '#1F1F1F', letterSpacing: '-0.012em' }}>5월 {day}일 · 목</div>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F' }}>세션 {sessions.length}건</div>
          </div>
          {sessions.map((s) => (
            <div key={s.time} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: '#F8F4FC' }}>
              <div style={{ fontFamily: 'var(--mb-font-mono)', fontWeight: 700, fontSize: 13, color: '#5F0080', width: 56, flex: 'none' }}>{s.time}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 14, color: '#1F1F1F' }}>{s.title}</div>
                <div style={{ fontFamily: 'var(--mb-font-text)', fontSize: 11, color: '#6F6F6F', marginTop: 2 }}>참여자 {s.count}명</div>
              </div>
              <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 9999, background: tagColor[s.tag].bg, color: tagColor[s.tag].fg, fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 10, letterSpacing: '0.04em' }}>{s.tag}</span>
            </div>
          ))}
          <button className="mb-btn mb-btn--soft" style={{ height: 40, marginTop: 4 }}>이 날 모든 세션 보기 →</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 18 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: '#FFFFFF', border: '1px solid #DDDEE7', borderRadius: 18, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6F6F6F' }}>{s.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 32, color: '#1F1F1F', letterSpacing: '-0.02em', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 13, color: toneArrow[s.tone].c }}>{toneArrow[s.tone].a}{s.delta}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18, background: '#FFFFFF', border: '1px solid #DDDEE7', borderRadius: 18, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 15, color: '#1F1F1F' }}>최근 활동</div>
          <a style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 12, color: '#5F0080', textDecoration: 'none', cursor: 'pointer' }}>전체</a>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activities.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor[it.tone], marginTop: 6, flex: 'none', boxShadow: `0 0 0 3px ${dotColor[it.tone]}22` }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--mb-font-text)', fontSize: 13, color: '#1F1F1F', lineHeight: '19px' }}>
                  <strong style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700 }}>{it.who}</strong>
                  {'  '}
                  {it.what}
                </div>
                <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#A2A3AD', marginTop: 2 }}>{it.when}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function SessionRunning() {
  type SeatState = 'measuring' | 'paired' | 'waiting' | 'empty';
  const seats: Array<{ n: number; state: SeatState; name: string }> = [
    { n: 1, state: 'measuring', name: '채이서' },
    { n: 2, state: 'measuring', name: '박서연' },
    { n: 3, state: 'measuring', name: '김도윤' },
    { n: 4, state: 'paired', name: '이하준' },
    { n: 5, state: 'measuring', name: '정유나' },
    { n: 6, state: 'waiting', name: '송지호' },
    { n: 7, state: 'measuring', name: '조은서' },
    { n: 8, state: 'paired', name: '한아윤' },
    { n: 9, state: 'measuring', name: '윤시우' },
    { n: 10, state: 'measuring', name: '강민서' },
    { n: 11, state: 'waiting', name: '장하린' },
    { n: 12, state: 'empty', name: '' },
  ];
  const stateMap: Record<SeatState, { bg: string; color: string; indicator: string; label: string }> = {
    measuring: { bg: '#5F0080', color: '#FFFFFF', indicator: '#01F0C8', label: '측정 중' },
    paired: { bg: '#D2AEFC', color: '#5F0080', indicator: '#5F0080', label: '연결됨' },
    waiting: { bg: '#F5EDFC', color: '#5F0080', indicator: '#B373EF', label: '대기' },
    empty: { bg: '#F2F3F8', color: '#A2A3AD', indicator: '#DDDEE7', label: '비어 있음' },
  };

  return (
    <AppShell
      title="마음챙김 입문 · 4주차"
      sub="진행 중 · 청담센터 A 스튜디오 · 10:30"
      contentPad="24px 32px"
      rightSlot={
        <>
          <StatusPill tone="primary" leading={<span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: '#01F0C8', boxShadow: '0 0 0 4px rgba(1,240,200,0.3)' }} />}>세션 진행 중 · 12:48</StatusPill>
          <StatusPill tone="soft">LB-A02E1</StatusPill>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, height: '100%' }}>
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <span className="mb-eyebrow" style={{ background: '#191A1E', color: '#01F0C8' }}>LIVE</span>
            <span className="mb-eyebrow">12 / 12명 입실</span>
            <span className="mb-eyebrow">측정 중 8명 · 대기 2명</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
            {seats.map((seat) => {
              const s = stateMap[seat.state];
              return (
                <div key={seat.n} style={{ background: s.bg, color: s.color, borderRadius: 16, padding: 14, height: 110, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'var(--mb-font-sans)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--mb-font-mono)', fontWeight: 700, fontSize: 18 }}>{String(seat.n).padStart(2, '0')}</span>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: s.indicator, boxShadow: seat.state === 'measuring' ? '0 0 0 4px rgba(1,240,200,0.25)' : 'none' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: '20px' }}>{seat.name || '—'}</div>
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{s.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 24, padding: 20, borderRadius: 20, background: '#F5EDFC', display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 64, height: 64, borderRadius: 32, background: '#5F0080', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StrokeIcon d={ICONS.pause} size={24} color="#FFFFFF" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 17, color: '#1F1F1F' }}>호흡을 따라가는 명상 · 2단계</div>
              <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 12, color: '#6F6F6F', marginTop: 4 }}>12:48 / 20:00</div>
              <div style={{ height: 6, background: '#FFFFFF', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
                <div style={{ width: '64%', height: '100%', background: 'linear-gradient(90deg,#5F0080,#B373EF)' }} />
              </div>
            </div>
            <button className="mb-btn" style={{ height: 44 }}>다음 단계</button>
          </div>
        </div>
        <aside style={{ background: '#FFFFFF', border: '1px solid #EFEFEF', borderRadius: 20, padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F', letterSpacing: '0.06em', textTransform: 'uppercase' }}>실시간 평균</div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 22, color: '#1F1F1F', marginTop: 4 }}>휴식도 지수</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 56, color: '#5F0080', lineHeight: 1, letterSpacing: '-0.04em' }}>72</div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F' }}>지난 평균</div>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 16, color: '#1F1F1F' }}>64</div>
              <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#59CE90', marginTop: 2 }}>▲ +8</div>
            </div>
          </div>
          <svg viewBox="0 0 280 80" style={{ width: '100%', height: 80 }}>
            <defs>
              <linearGradient id="mb-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#B373EF" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#B373EF" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path d="M0 60 C 20 50, 40 55, 60 45 S 100 30, 130 38 S 180 18, 220 22 S 260 35, 280 28 L 280 80 L 0 80 Z" fill="url(#mb-area)" />
            <path d="M0 60 C 20 50, 40 55, 60 45 S 100 30, 130 38 S 180 18, 220 22 S 260 35, 280 28" fill="none" stroke="#5F0080" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <div style={{ borderTop: '1px solid #EFEFEF', paddingTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { l: '주의력 (β)', v: '68' },
              { l: '이완 (α)', v: '74' },
              { l: '몰입 (γ)', v: '61' },
              { l: '균형도', v: '0.82' },
            ].map((m) => (
              <div key={m.l}>
                <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F' }}>{m.l}</div>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 20, color: '#1F1F1F' }}>{m.v}</div>
              </div>
            ))}
          </div>
          <button className="mb-btn mb-btn--ghost" style={{ width: '100%', height: 44, marginTop: 'auto' }}>세션 종료 후 리포트 발급</button>
        </aside>
      </div>
    </AppShell>
  );
}

function Clients() {
  const { open } = useModal();
  const [filter, setFilter] = useState('전체');
  type Row = {
    name: string; initial: string; progress: number; ringColor: string; gradient: string;
    program: string; programDetail: string; statusTone: 'active' | 'pending' | 'paused'; statusLabel: string;
    bars: number[]; barPalette: string[]; deltaTone: 'up' | 'down' | 'flat'; deltaValue: string;
    next: { dow: string; num: string; time?: string; muted?: boolean }; featured?: boolean; paused?: boolean;
  };
  const rows: Row[] = [
    { name: '김민지', initial: '민', progress: 0.75, ringColor: '#5F0080', gradient: 'linear-gradient(140deg, #B373EF 10%, #5F0080 100%)', program: '정기 8주', programDetail: '4 / 8회차', statusTone: 'active', statusLabel: '활동중 · 측정 진행', bars: [0.3, 0.48, 0.42, 0.65, 0.58, 0.78, 0.92], barPalette: ['#E8D8F8', '#D7BCEC', '#A775D6', '#5F0080'], deltaTone: 'up', deltaValue: '18%', next: { dow: '목', num: '21', time: '09:30' }, featured: true },
    { name: '박서준', initial: '박', progress: 0.25, ringColor: '#E6593D', gradient: 'linear-gradient(140deg, #FFC79A 10%, #E6593D 100%)', program: '1:1 코칭', programDetail: '2 / 8회차', statusTone: 'active', statusLabel: '활동중', bars: [0.55, 0.6, 0.52, 0.62, 0.5, 0.58, 0.55], barPalette: ['#FFD4C2', '#FFC2A8', '#F49C7B', '#E6593D'], deltaTone: 'flat', deltaValue: '안정', next: { dow: '금', num: '22', time: '19:00' } },
    { name: '정수아', initial: '정', progress: 0.5, ringColor: '#1F8A5B', gradient: 'linear-gradient(140deg, #9CE9C4 10%, #1F8A5B 100%)', program: '사내 워크숍', programDetail: '라온건강원', statusTone: 'pending', statusLabel: '리포트 발급 대기', bars: [0.88, 0.8, 0.72, 0.65, 0.58, 0.45, 0.38], barPalette: ['#C9ECDB', '#A8DDC1', '#7CCBA0', '#1F8A5B'], deltaTone: 'up', deltaValue: '24%', next: { dow: '예정', num: '미정', muted: true } },
    { name: '이도윤', initial: '이', progress: 0.37, ringColor: '#C2C3CE', gradient: 'linear-gradient(140deg, #B7C5F3 10%, #5E4FFF 100%)', program: '청소년 집중력', programDetail: '6 / 12회차', statusTone: 'paused', statusLabel: '일시 중지 · 5월 11일', bars: [0.3, 0.38, 0.32, 0.48, 0.52, 0.6, 0.68], barPalette: ['#EAECF1', '#DDDFE6', '#CACCD5', '#A2A3AD'], deltaTone: 'down', deltaValue: '9%', next: { dow: '—', num: '없음', muted: true }, paused: true },
    { name: '최예린', initial: '최', progress: 0.12, ringColor: '#5F0080', gradient: 'linear-gradient(140deg, #FFC9C7 10%, #D33F3F 100%)', program: '바디스캔 입문', programDetail: '1 / 8회차', statusTone: 'active', statusLabel: '활동중 · 신규', bars: [0.2, 0.32, 0.38, 0.42, 0.5, 0.62, 0.7], barPalette: ['#E8D8F8', '#D7BCEC', '#A775D6', '#5F0080'], deltaTone: 'down', deltaValue: '12%', next: { dow: '월', num: '26', time: '11:00' } },
  ];
  const C = 2 * Math.PI * 26;
  const statusTones: Record<string, { c: string; d: string; halo: string }> = {
    active: { c: '#1F8A5B', d: '#59CE90', halo: 'rgba(89,206,144,0.18)' },
    pending: { c: '#B57C00', d: '#EFC14C', halo: 'rgba(239,193,76,0.20)' },
    paused: { c: '#6F6F6F', d: '#A2A3AD', halo: 'rgba(162,163,173,0.20)' },
  };
  const deltaTones: Record<string, string> = { up: '#1F8A5B', down: '#D33F3F', flat: '#6F6F6F' };
  const deltaArr: Record<string, string> = { up: '↓', down: '↑', flat: '·' };

  return (
    <AppShell
      title="참여자"
      sub="활동중 12 · 대기 3 · 일시중지 1"
      rightSlot={
        <>
          <button style={{ height: 44, padding: '0 14px', borderRadius: 22, border: '1px solid #DDDEE7', background: '#FFFFFF', display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 14, color: '#1F1F1F' }}>
            <StrokeIcon d={ICONS.search} size={18} />이름 / 전화
          </button>
          <button className="mb-btn" style={{ height: 44, padding: '0 18px', borderRadius: 22, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <StrokeIcon d={ICONS.plus} size={18} color="#FFFFFF" />참여자 추가
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14, background: '#FFFFFF', border: '1px solid #E8E4F0', borderRadius: 9999, padding: 4, width: 'fit-content' }}>
        {['전체', '이번 주', '리포트 대기', '일시 중지'].map((t) => (
          <button key={t} onClick={() => setFilter(t)} style={{ border: 0, padding: '8px 14px', borderRadius: 9999, cursor: 'pointer', background: filter === t ? '#5F0080' : 'transparent', color: filter === t ? '#FFFFFF' : '#6F6F6F', fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 13 }}>{t}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => {
          const tone = statusTones[r.statusTone];
          return (
            <div key={r.name} style={{ background: r.featured ? '#FBF7FE' : '#FFFFFF', border: r.featured ? '1px solid #E8D8F8' : '1px solid #EFEFEF', borderRadius: 20, padding: '18px 22px 18px 18px', display: 'grid', gridTemplateColumns: '70px 1.3fr 1.6fr 90px 36px', alignItems: 'center', gap: 20 }}>
              <div style={{ width: 64, height: 64, position: 'relative', flex: 'none' }}>
                <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="32" cy="32" r="26" fill="none" stroke="#F0EBF6" strokeWidth="3" />
                  <circle cx="32" cy="32" r="26" fill="none" stroke={r.ringColor} strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - r.progress)} />
                </svg>
                <div style={{ position: 'absolute', inset: 5, borderRadius: '50%', background: r.gradient, opacity: r.paused ? 0.78 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>{r.initial}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 17, color: r.paused ? '#6F6F6F' : '#1F1F1F', letterSpacing: '-0.014em', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {r.name}
                  {r.featured && <span style={{ color: '#C2A6E0', fontSize: 13 }}>★</span>}
                </div>
                <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 13, color: '#6F6F6F', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {r.program}
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#C2C3CE' }} />
                  {r.programDetail}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 12, color: tone.c }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone.d, boxShadow: `0 0 0 3px ${tone.halo}` }} />
                    {r.statusLabel}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, paddingLeft: 20, borderLeft: '1px solid #F0EBF6' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 36, flex: 'none' }}>
                  {r.bars.map((v, i) => {
                    const tier = i < 2 ? r.barPalette[0] : i < 4 ? r.barPalette[1] : i < 6 ? r.barPalette[2] : r.barPalette[3];
                    return <div key={i} style={{ width: 11, height: `${Math.max(8, v * 100)}%`, background: tier, borderRadius: '4px 4px 2px 2px' }} />;
                  })}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end', paddingBottom: 1 }}>
                  <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 16, color: deltaTones[r.deltaTone], letterSpacing: '-0.012em' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, marginRight: 2 }}>{deltaArr[r.deltaTone]}</span>{r.deltaValue}
                  </div>
                  <div style={{ fontFamily: 'var(--mb-font-text)', fontSize: 11, color: '#6F6F6F' }}>vs 시작</div>
                </div>
              </div>
              <div>
                <div style={{ width: 68, minHeight: 68, borderRadius: 16, background: r.next.muted ? '#F2F3F8' : '#F5EDFC', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6px 0' }}>
                  <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, fontWeight: 600, color: r.next.muted ? '#6F6F6F' : '#5F0080', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{r.next.dow}</div>
                  <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, color: r.next.muted ? '#6F6F6F' : '#5F0080', fontSize: r.next.muted ? 14 : 22, lineHeight: '24px', letterSpacing: '-0.02em', marginTop: 2 }}>{r.next.num}</div>
                  {r.next.time && <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#5F0080', opacity: 0.7, marginTop: 1 }}>{r.next.time}</div>}
                </div>
              </div>
              <button onClick={() => open({ kind: r.paused ? 'danger' : 'confirm', title: r.paused ? `${r.name} 참여자를 삭제할까요?` : `${r.name} 참여자에게 리포트 발급?`, body: r.paused ? '참여자의 모든 측정 데이터와 리포트가 영구 삭제됩니다. 되돌릴 수 없습니다.' : '최근 측정 결과를 바탕으로 두뇌건강 리포트를 즉시 발송합니다.', cancel: '취소', confirm: r.paused ? '삭제' : '발급하기' })} style={{ width: 32, height: 32, borderRadius: 10, border: 0, background: 'transparent', color: '#A2A3AD', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <StrokeIcon d={ICONS.more} size={18} />
              </button>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

function Messages() {
  type Convo = { id: string; name: string; initial: string; gradient: string; last: string; when: string; unread: number; online: boolean };
  const convos: Convo[] = [
    { id: 'min', name: '김민지', initial: '민', gradient: 'linear-gradient(135deg,#B373EF,#5F0080)', last: '선생님, 오늘 세션 전에 잠깐 통화 가능하실까요?', when: '14:02', unread: 2, online: true },
    { id: 'park', name: '박서준', initial: '박', gradient: 'linear-gradient(135deg,#FFC79A,#E6593D)', last: '감사합니다. 다음 주 금요일에 뵙겠습니다.', when: '어제', unread: 0, online: false },
    { id: 'jung', name: '정수아', initial: '정', gradient: 'linear-gradient(135deg,#9CE9C4,#1F8A5B)', last: '리포트 잘 받았습니다 :)', when: '어제', unread: 0, online: true },
    { id: 'lee', name: '이도윤', initial: '이', gradient: 'linear-gradient(135deg,#B7C5F3,#5E4FFF)', last: '프로그램 잠시 멈추고 싶어요', when: '5/14', unread: 0, online: false },
    { id: 'choi', name: '최예린', initial: '최', gradient: 'linear-gradient(135deg,#FFC9C7,#D33F3F)', last: '기기 충전이 잘 안되는 것 같아요', when: '5/12', unread: 1, online: false },
    { id: 'han', name: '한아윤', initial: '한', gradient: 'linear-gradient(135deg,#FFE8B0,#D9A82B)', last: '감사해요 선생님!', when: '5/09', unread: 0, online: false },
  ];
  const [activeId, setActive] = useState('min');
  const active = convos.find((c) => c.id === activeId)!;

  const Bubble = ({ side, children, time }: { side: 'me' | 'them'; children: ReactNode; time: string }) => {
    const me = side === 'me';
    return (
      <div style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8, marginTop: 8 }}>
        {!me && <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#B373EF,#5F0080)', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 11 }}>민</div>}
        {me && <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#A2A3AD' }}>{time}</span>}
        <div style={{ maxWidth: '65%', padding: '12px 16px', borderRadius: me ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: me ? '#5F0080' : '#FFFFFF', color: me ? '#FFFFFF' : '#1F1F1F', border: me ? '0' : '1px solid #EFEFEF', fontFamily: 'var(--mb-font-text)', fontSize: 14, lineHeight: '21px', letterSpacing: '0.005em' }}>{children}</div>
        {!me && <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#A2A3AD' }}>{time}</span>}
      </div>
    );
  };

  return (
    <AppShell title="메시지" sub="참여자 1:1 채팅" contentPad="0" noScroll>
      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '320px 1fr 280px', overflow: 'hidden' }}>
        <div style={{ borderRight: '1px solid #EFEFEF', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid #F5F5F8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 40, borderRadius: 9999, background: '#F2F3F8' }}>
              <StrokeIcon d={ICONS.search} size={16} color="#A2A3AD" />
              <input placeholder="대화 검색" style={{ flex: 1, border: 0, background: 'transparent', outline: 'none', fontFamily: 'var(--mb-font-sans)', fontSize: 13, color: '#1F1F1F' }} />
            </div>
          </div>
          <div style={{ overflow: 'auto', padding: '8px 8px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {convos.map((c) => (
              <button key={c.id} onClick={() => setActive(c.id)} style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', background: c.id === activeId ? '#F5EDFC' : 'transparent', padding: '14px 14px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', flex: 'none', background: c.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 15, border: '2px solid #FFFFFF', boxShadow: '0 0 0 1px #E8E4F0', position: 'relative' }}>
                  {c.initial}
                  {c.online && <span style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: '50%', background: '#59CE90', border: '2px solid #FFFFFF' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: c.id === activeId || c.unread ? 700 : 600, fontSize: 14, color: '#1F1F1F', letterSpacing: '-0.012em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                    <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: c.unread ? '#5F0080' : '#A2A3AD', flex: 'none' }}>{c.when}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3, gap: 8 }}>
                    <span style={{ fontFamily: 'var(--mb-font-text)', fontSize: 12, color: c.unread ? '#1F1F1F' : '#6F6F6F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, fontWeight: c.unread ? 600 : 500 }}>{c.last}</span>
                    {c.unread > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 6px', borderRadius: 9, background: '#5F0080', color: '#FFFFFF', fontFamily: 'var(--mb-font-mono)', fontWeight: 700, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{c.unread}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', overflow: 'hidden', background: '#FAFAFB' }}>
          <div style={{ padding: '14px 22px', background: '#FFFFFF', borderBottom: '1px solid #EFEFEF', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: active.gradient, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14 }}>{active.initial}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 15, color: '#1F1F1F', letterSpacing: '-0.012em' }}>{active.name} · 참여자</div>
              <div style={{ fontFamily: 'var(--mb-font-text)', fontSize: 12, color: '#6F6F6F', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                {active.online && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#59CE90', boxShadow: '0 0 0 3px rgba(89,206,144,0.2)' }} />}
                {active.online ? '지금 활동 중' : '마지막 접속 어제'}
              </div>
            </div>
            <button className="mb-btn mb-btn--soft" style={{ height: 36, padding: '0 14px', fontSize: 12, borderRadius: 9999 }}>리포트 보기</button>
          </div>
          <div style={{ overflow: 'auto', padding: '16px 22px' }}>
            <div style={{ textAlign: 'center', fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#A2A3AD', letterSpacing: '0.08em', margin: '8px 0 16px' }}>5월 21일 · 목요일</div>
            <Bubble side="them" time="14:02">선생님, 오늘 세션 전에 잠깐 통화 가능하실까요?</Bubble>
            <Bubble side="me" time="14:04">네 가능해요. 14:30에 전화드릴게요 🙂</Bubble>
            <Bubble side="them" time="14:08">2주차 리포트 같이 살펴보면 좋을 것 같아서요.</Bubble>
            <Bubble side="me" time="14:09">확인했어요. 14:30에 전화 드리면서 자세히 이야기 나눠봐요.</Bubble>
          </div>
          <div style={{ padding: '14px 22px', background: '#FFFFFF', borderTop: '1px solid #EFEFEF', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={{ width: 40, height: 40, borderRadius: 20, border: 0, background: 'transparent', color: '#6F6F6F', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StrokeIcon d={ICONS.attach} size={20} />
            </button>
            <input placeholder="메시지를 입력하세요…" style={{ flex: 1, height: 44, borderRadius: 9999, background: '#F2F3F8', border: 0, padding: '0 18px', fontFamily: 'var(--mb-font-sans)', fontSize: 14, color: '#1F1F1F', outline: 'none' }} />
            <button style={{ width: 44, height: 44, borderRadius: '50%', background: '#5F0080', color: '#FFFFFF', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StrokeIcon d={ICONS.send} size={18} color="#FFFFFF" />
            </button>
          </div>
        </div>
        <div style={{ borderLeft: '1px solid #EFEFEF', padding: '20px 18px', overflow: 'auto', background: '#FFFFFF' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingBottom: 18, borderBottom: '1px solid #F5F5F8' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: active.gradient, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 22 }}>{active.initial}</div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 16, color: '#1F1F1F', marginTop: 12 }}>{active.name}</div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontSize: 12, color: '#6F6F6F', marginTop: 2 }}>정기 8주 · 4 / 8회차</div>
          </div>
          <div style={{ marginTop: 18 }}>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6F6F6F', marginBottom: 10 }}>최근 측정</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 50 }}>
              {[0.3, 0.48, 0.42, 0.65, 0.58, 0.78, 0.92].map((v, i) => {
                const tier = i < 2 ? '#E8D8F8' : i < 4 ? '#D7BCEC' : i < 6 ? '#A775D6' : '#5F0080';
                return <div key={i} style={{ flex: 1, height: `${v * 100}%`, background: tier, borderRadius: '4px 4px 2px 2px' }} />;
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
              <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 22, color: '#1F1F1F', letterSpacing: '-0.02em' }}>72</span>
              <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 12, color: '#1F8A5B' }}>↓18% vs 시작</span>
            </div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontSize: 11, color: '#6F6F6F', marginTop: 2 }}>휴식도 · 최근 7회</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function SignIn() {
  return (
    <div style={{ position: 'relative', width: 1366, height: 1024, overflow: 'hidden', borderRadius: 24, border: '1px solid #DDDEE7' }}>
      <img src={`${ASSET}/images/thumbnail3.jpg`} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)' }} />
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <img src={`${ASSET}/logo_symbol_dark.svg`} width="84" height="38" alt="" style={{ filter: 'brightness(0) invert(1)' }} />
        <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 32, color: '#FFFFFF', letterSpacing: '-0.02em' }}>mind&nbsp;breeze</div>
        <div style={{ fontFamily: 'var(--mb-font-text)', fontSize: 15, color: 'rgba(255,255,255,0.86)', marginBottom: 28 }}>지도사 전용 · MIND BREEZE Operator</div>
        {[
          { icon: 'icon_google.svg', label: 'Sign in with Google' },
          { icon: 'icon_apple.svg', label: 'Sign in with Apple' },
        ].map((b) => (
          <button key={b.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, justifyContent: 'center', height: 52, width: 280, borderRadius: 40, background: '#FFFFFF', border: '1px solid #DDDEE7', fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 15, color: '#1F1F1F', cursor: 'pointer' }}>
            <img src={`${ASSET}/icons/${b.icon}`} width="20" height="20" alt="" />
            {b.label}
          </button>
        ))}
        <div style={{ marginTop: 28, fontFamily: 'var(--mb-font-text)', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>기관 발급 계정으로만 접속하실 수 있습니다.</div>
      </div>
    </div>
  );
}

function Modal({ data, onClose }: { data: ModalData; onClose: () => void }) {
  if (!data) return null;
  const danger = data.kind === 'danger';
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(0,0,0,0.18), rgba(0,0,0,0.18)), linear-gradient(135deg, rgba(95,0,128,0.35) 0%, rgba(135,94,179,0.30) 100%)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, background: '#FFFFFF', borderRadius: 22, padding: '28px 28px 22px', boxShadow: '0 12px 30px rgba(95,0,128,0.18)', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderRadius: '50%', border: 0, background: '#F2F3F8', color: '#6F6F6F', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: danger ? 'rgba(252,85,85,0.12)' : '#F5EDFC', color: danger ? '#D33F3F' : '#5F0080', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {danger ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v7c0 5 4 8 8 10 4-2 8-5 8-10V5l-8-3z" /><polyline points="9 12 11 14 15 10" /></svg>
          )}
        </div>
        <h3 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 19, lineHeight: '26px', letterSpacing: '-0.014em', color: '#1F1F1F', margin: '16px 0 8px' }}>{data.title}</h3>
        <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 14, lineHeight: '22px', color: '#6F6F6F', margin: 0 }}>{data.body}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
          <button onClick={onClose} className="mb-btn mb-btn--ghost" style={{ flex: 1, height: 44, fontSize: 14, borderRadius: 12 }}>{data.cancel || '취소'}</button>
          <button onClick={onClose} className="mb-btn" style={{ flex: 1, height: 44, fontSize: 14, borderRadius: 12, background: danger ? '#D33F3F' : undefined }}>{data.confirm || '확인'}</button>
        </div>
      </div>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <AppShell title={title} sub="UI 준비 중">
      <div style={{ padding: 40, color: '#6F6F6F' }}>이 화면은 다른 키트와 동일한 디자인 시스템을 사용합니다.</div>
    </AppShell>
  );
}

export default function OperatorAppPage() {
  const [route, setRoute] = useState<RouteId>('dashboard');
  const [modal, setModal] = useState<ModalData>(null);
  const navValue = { route, go: setRoute };
  const modalValue = { open: setModal, close: () => setModal(null) };

  let content: ReactNode;
  switch (route) {
    case 'signin':
      content = <SignIn />;
      break;
    case 'session-running':
      content = <SessionRunning />;
      break;
    case 'clients':
      content = <Clients />;
      break;
    case 'messages':
      content = <Messages />;
      break;
    case 'reports':
      content = <Placeholder title="리포트" />;
      break;
    case 'settings':
      content = <Placeholder title="설정" />;
      break;
    default:
      content = <Dashboard />;
  }

  return (
    <NavCtx.Provider value={navValue}>
      <ModalCtx.Provider value={modalValue}>
        <div style={{ minHeight: '100vh', background: '#EBE6E2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: -36, left: 4, display: 'flex', gap: 8 }}>
              {(['signin', 'dashboard', 'session-running', 'clients', 'messages'] as RouteId[]).map((r) => (
                <button key={r} onClick={() => setRoute(r)} style={{ background: route === r ? '#5F0080' : '#FFFFFF', color: route === r ? '#FFFFFF' : '#5F0080', border: '1px solid #5F0080', borderRadius: 9999, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--mb-font-sans)' }}>{r}</button>
              ))}
            </div>
            {content}
            <Modal data={modal} onClose={() => setModal(null)} />
          </div>
        </div>
      </ModalCtx.Provider>
    </NavCtx.Provider>
  );
}
