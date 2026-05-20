import { useState, type ReactNode, type CSSProperties } from 'react';

const ASSET = '/mb-design/assets';

type Tab = 'home' | 'class' | 'session' | 'report' | 'profile';

const ICONS: Record<string, string[]> = {
  home: ['M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z'],
  calendar: ['M8 2v4', 'M16 2v4', 'M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  report: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M9 13h6', 'M9 17h4'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  chevronR: ['m9 18 6-6-6-6'],
  chevronL: ['m15 18-6-6 6-6'],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  pause: ['M6 4h4v16H6z', 'M14 4h4v16h-4z'],
  share: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'm16 6-4-4-4 4', 'M12 2v13'],
  cog: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
};

function TopBar({ left, right, eyebrow, title }: { left?: ReactNode; right?: ReactNode; eyebrow?: string; title?: string }) {
  return (
    <div style={{ paddingTop: 56, paddingLeft: 20, paddingRight: 20, paddingBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#1F1F1F', flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {left}
        <div>
          {eyebrow && <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)' }}>{eyebrow}</div>}
          {title && <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.014em', marginTop: eyebrow ? 2 : 0 }}>{title}</div>}
        </div>
      </div>
      <div>{right}</div>
    </div>
  );
}

function RoundBtn({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ width: 38, height: 38, borderRadius: 19, background: 'rgba(255,255,255,0.7)', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}>
      {children}
    </button>
  );
}

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: Array<{ id: Tab; label: string; icon: string[] }> = [
    { id: 'home', label: '오늘', icon: ICONS.home },
    { id: 'class', label: '클래스', icon: ICONS.calendar },
    { id: 'report', label: '리포트', icon: ICONS.report },
    { id: 'profile', label: '프로필', icon: ICONS.user },
  ];
  return (
    <div style={{ flex: 'none', paddingBottom: 34, paddingTop: 10, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px) saturate(180%)', borderTop: '0.5px solid rgba(0,0,0,0.06)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{ background: 'transparent', border: 0, padding: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: on ? '#5F0080' : '#A2A3AD' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? '2' : '1.6'} strokeLinecap="round" strokeLinejoin="round">
              {t.icon.map((d, i) => <path key={i} d={d} />)}
            </svg>
            <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: on ? 700 : 500, fontSize: 10, letterSpacing: '-0.01em' }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Shell({ children, tab, onTab, top, bg = '#F5EDFC', hideTabs = false }: { children: ReactNode; tab: Tab; onTab: (t: Tab) => void; top?: ReactNode; bg?: string; hideTabs?: boolean }) {
  return (
    <div style={{ width: 402, height: 874, background: bg, display: 'flex', flexDirection: 'column', fontFamily: 'var(--mb-font-sans)', color: '#1F1F1F', borderRadius: 48, overflow: 'hidden', boxShadow: '0 24px 60px rgba(95,0,128,0.18)' }}>
      {top}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>{children}</div>
      {!hideTabs && <TabBar active={tab} onChange={onTab} />}
    </div>
  );
}

function HomeScreen({ tab, onTab, go }: { tab: Tab; onTab: (t: Tab) => void; go: (t: Tab) => void }) {
  return (
    <Shell tab={tab} onTab={onTab} bg="#F5EDFC" top={<TopBar eyebrow="2026.05.21 · 목요일" title="안녕하세요, 민지님" right={<RoundBtn><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ICONS.bell.map((d, i) => <path key={i} d={d} />)}</svg></RoundBtn>} />}>
      <div style={{ padding: '0 16px 16px' }}>
        <button onClick={() => go('session')} style={{ width: '100%', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', background: 'transparent', borderRadius: 24, overflow: 'hidden', position: 'relative', height: 200 }}>
          <img src={`${ASSET}/images/portrait_06_woman_purple_sunset.png`} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%)' }} />
          <div style={{ position: 'absolute', top: 16, left: 18, display: 'flex', gap: 6 }}>
            <span style={{ display: 'inline-flex', padding: '5px 10px', borderRadius: 9999, background: 'rgba(255,255,255,0.92)', color: '#5F0080', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 10, letterSpacing: '0.04em' }}>오늘의 추천</span>
            <span style={{ display: 'inline-flex', padding: '5px 10px', borderRadius: 9999, background: 'rgba(255,255,255,0.2)', color: '#FFFFFF', fontFamily: 'var(--mb-font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.04em', backdropFilter: 'blur(8px)' }}>12분</span>
          </div>
          <div style={{ position: 'absolute', left: 18, right: 18, bottom: 14, color: '#FFFFFF' }}>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.018em', lineHeight: '26px' }}>저녁의 호흡 정리</div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>하루를 마무리하는 4-7-8 호흡 명상</div>
            <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FFFFFF', color: '#5F0080', padding: '8px 14px', borderRadius: 9999, fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 12 }}>▶ &nbsp;시작하기</div>
          </div>
        </button>
      </div>
      <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 14 }}>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#6F6F6F', letterSpacing: '0.08em', textTransform: 'uppercase' }}>이번 주 휴식도</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
            <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 28, color: '#5F0080', letterSpacing: '-0.02em' }}>72</span>
            <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 12, color: '#1F8A5B' }}>↓18%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 22, marginTop: 8 }}>
            {[0.3, 0.48, 0.42, 0.65, 0.58, 0.78, 0.92].map((v, i) => {
              const tier = i < 2 ? '#E8D8F8' : i < 4 ? '#D7BCEC' : i < 6 ? '#A775D6' : '#5F0080';
              return <div key={i} style={{ flex: 1, height: `${v * 100}%`, background: tier, borderRadius: '3px 3px 2px 2px' }} />;
            })}
          </div>
        </div>
        <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 14 }}>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#6F6F6F', letterSpacing: '0.08em', textTransform: 'uppercase' }}>연속 명상</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
            <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 28, color: '#1F1F1F', letterSpacing: '-0.02em' }}>14</span>
            <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 12, color: '#6F6F6F' }}>일째</span>
          </div>
          <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: 22, borderRadius: 3, background: i === 13 ? '#5F0080' : `rgba(95,0,128,${0.18 + 0.05 * (i / 14)})` }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#F5EDFC', color: '#5F0080', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em' }}>금</div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>22</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, fontWeight: 600, color: '#5F0080', letterSpacing: '0.08em', textTransform: 'uppercase' }}>다음 클래스</div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 15, color: '#1F1F1F', marginTop: 4, letterSpacing: '-0.012em' }}>아침 마음챙김 · 5회차</div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: '#6F6F6F', marginTop: 2 }}>09:30 · 김지수 지도사 · 청담센터</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 10px' }}>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 15, color: '#1F1F1F', letterSpacing: '-0.012em' }}>최근 리포트</div>
          <a onClick={() => go('report')} style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 12, color: '#5F0080', textDecoration: 'none', cursor: 'pointer' }}>전체</a>
        </div>
        <div style={{ background: '#FFFFFF', borderRadius: 18, padding: '4px 4px' }}>
          {[
            { d: '5월 18일', t: '저녁의 호흡 정리', sc: 72, dl: '+8' },
            { d: '5월 15일', t: '수면을 위한 명상', sc: 65, dl: '+3' },
            { d: '5월 13일', t: '아침 마음챙김 4회차', sc: 61, dl: '—' },
          ].map((r, i) => (
            <div key={i} onClick={() => go('report')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px', borderBottom: i < 2 ? '1px solid #F5F5F8' : '0', cursor: 'pointer' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: `conic-gradient(#5F0080 ${r.sc * 3.6}deg, #F0EBF6 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 11, color: '#1F1F1F' }}>{r.sc}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 14, color: '#1F1F1F' }}>{r.t}</div>
                <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F', marginTop: 2 }}>{r.d}</div>
              </div>
              <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 12, color: r.dl === '—' ? '#A2A3AD' : '#1F8A5B' }}>{r.dl}</span>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function ClassScreen({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const upcoming = [
    { dow: '금', num: '22', title: '아침 마음챙김 · 5회차', who: '김지수 지도사 · 청담센터', time: '09:30', type: '오프라인' },
    { dow: '월', num: '25', title: '수면을 위한 호흡 명상', who: '박재은 지도사 · 라이브', time: '21:00', type: '온라인' },
    { dow: '수', num: '27', title: '직장인 스트레스 케어', who: '이도연 지도사 · 라이브', time: '12:30', type: '온라인' },
    { dow: '금', num: '29', title: '아침 마음챙김 · 6회차', who: '김지수 지도사 · 청담센터', time: '09:30', type: '오프라인' },
  ];
  return (
    <Shell tab={tab} onTab={onTab} top={<TopBar eyebrow="2026.05 · 5월 셋째 주" title="클래스" />}>
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ borderRadius: 22, overflow: 'hidden', position: 'relative', height: 200 }}>
          <img src={`${ASSET}/images/feature_inhale_mountain.png`} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%)' }} />
          <div style={{ position: 'absolute', top: 14, left: 16, display: 'flex', gap: 6 }}>
            <span style={{ padding: '5px 10px', borderRadius: 9999, background: 'rgba(255,255,255,0.92)', color: '#5F0080', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 10, letterSpacing: '0.04em' }}>NEW</span>
            <span style={{ padding: '5px 10px', borderRadius: 9999, background: 'rgba(255,255,255,0.2)', color: '#FFFFFF', fontFamily: 'var(--mb-font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.04em', backdropFilter: 'blur(8px)' }}>8주 프로그램</span>
          </div>
          <div style={{ position: 'absolute', left: 18, right: 18, bottom: 16, color: '#FFFFFF' }}>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 21, letterSpacing: '-0.018em', lineHeight: '26px' }}>산속의 호흡</div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>자연의 리듬으로 마음을 정리하는 8주 코스</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 20px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 16, color: '#1F1F1F', letterSpacing: '-0.012em' }}>예정된 클래스</div>
        <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F' }}>{upcoming.length}건</div>
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {upcoming.map((u, i) => {
          const onTone = u.type === '오프라인' ? { bg: '#F5EDFC', fg: '#5F0080' } : { bg: '#E6F8F3', fg: '#1F8A5B' };
          return (
            <div key={i} style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 52, height: 56, borderRadius: 12, background: '#F5EDFC', color: '#5F0080', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em' }}>{u.dow}</div>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 19, letterSpacing: '-0.02em' }}>{u.num}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ padding: '3px 8px', borderRadius: 9999, background: onTone.bg, color: onTone.fg, fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 9, letterSpacing: '0.04em' }}>{u.type}</span>
                  <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, fontWeight: 600, color: '#5F0080' }}>{u.time}</span>
                </div>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, color: '#1F1F1F', marginTop: 4, letterSpacing: '-0.012em' }}>{u.title}</div>
                <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 11, color: '#6F6F6F', marginTop: 2 }}>{u.who}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

function SessionScreen({ tab, onTab, onExit }: { tab: Tab; onTab: (t: Tab) => void; onExit: () => void }) {
  return (
    <div style={{ width: 402, height: 874, position: 'relative', overflow: 'hidden', background: 'radial-gradient(120% 80% at 50% 35%, #C297E0 0%, #5F0080 70%, #2B0042 100%)', fontFamily: 'var(--mb-font-sans)', color: '#FFFFFF', borderRadius: 48, boxShadow: '0 24px 60px rgba(95,0,128,0.18)' }}>
      <div style={{ position: 'absolute', top: 56, left: 16, right: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 }}>
        <button onClick={onExit} style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,0.18)', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round">
            {ICONS.close.map((d, i) => <path key={i} d={d} />)}
          </svg>
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.7)' }}>STEP 2 / 4</div>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, marginTop: 2 }}>호흡 정리</div>
        </div>
        <div style={{ width: 40 }} />
      </div>
      <div style={{ position: 'absolute', top: 160, left: 0, right: 0, height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.0) 56%, rgba(255,255,255,0.10) 72%, rgba(255,255,255,0.0) 100%)', animation: 'mbBreath 8s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.0) 50%, rgba(255,255,255,0.16) 76%, rgba(255,255,255,0.0) 100%)', animation: 'mbBreath 8s ease-in-out infinite', animationDelay: '0.4s' } as CSSProperties} />
        <div style={{ position: 'absolute', width: 168, height: 168, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', boxShadow: '0 12px 40px rgba(255,255,255,0.18), inset 0 0 60px rgba(195,151,224,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', animation: 'mbBreath 8s ease-in-out infinite' }}>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, fontWeight: 700, color: '#5F0080', letterSpacing: '0.16em', textTransform: 'uppercase' }}>INHALE</div>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 36, color: '#5F0080', marginTop: 4, letterSpacing: '-0.02em' }}>들숨</div>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: 'rgba(95,0,128,0.6)', marginTop: 6 }}>4초 동안 천천히</div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 530, left: 24, right: 24, background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(14px)', borderRadius: 18, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, border: '1px solid rgba(255,255,255,0.16)' }}>
        <div>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase' }}>실시간 휴식도</div>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 28, color: '#FFFFFF', letterSpacing: '-0.02em', lineHeight: 1, marginTop: 4 }}>78</div>
        </div>
        <svg viewBox="0 0 180 36" style={{ flex: 1, height: 36 }}>
          <path d="M0,18 L12,16 L20,22 L28,10 L38,18 L46,6 L58,16 L70,8 L82,14 L92,4 L104,12 L116,8 L128,18 L138,10 L150,16 L162,8 L172,14 L180,10" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          <path d="M0,18 L12,16 L20,22 L28,10 L38,18 L46,6 L58,16 L70,8 L82,14 L92,4 L104,12 L116,8" fill="none" stroke="#01F0C8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="116" cy="8" r="3" fill="#01F0C8" />
        </svg>
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 24px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
          <span>04:32</span>
          <span style={{ color: '#FFFFFF', fontWeight: 700 }}>저녁의 호흡 정리</span>
          <span>12:00</span>
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.22)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: '38%', height: '100%', background: 'linear-gradient(90deg, #FFFFFF, #01F0C8)' }} />
        </div>
        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}>
          <button style={{ width: 80, height: 80, borderRadius: 40, background: '#FFFFFF', color: '#5F0080', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 1px rgba(25,26,30,0.06)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              {ICONS.pause.map((d, i) => <path key={i} d={d} />)}
            </svg>
          </button>
        </div>
      </div>
      <style>{`@keyframes mbBreath {0%,100%{transform:scale(0.92);opacity:0.95}50%{transform:scale(1.05);opacity:1}}`}</style>
      {/* hide tabs for session by using a small bar */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
        <TabBar active={tab} onChange={onTab} />
      </div>
    </div>
  );
}

function ReportScreenV({ tab, onTab, back }: { tab: Tab; onTab: (t: Tab) => void; back: () => void }) {
  const C = 2 * Math.PI * 52;
  const score = 72;
  return (
    <Shell tab={tab} onTab={onTab} top={<TopBar left={<RoundBtn onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS.chevronL.map((d, i) => <path key={i} d={d} />)}</svg></RoundBtn>} eyebrow="2026.05.18 · 18분" title="저녁의 호흡 정리" right={<RoundBtn><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS.share.map((d, i) => <path key={i} d={d} />)}</svg></RoundBtn>} />}>
      <div style={{ padding: '8px 16px 0' }}>
        <div style={{ background: '#FFFFFF', borderRadius: 22, padding: 22, display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 140, height: 140, position: 'relative' }}>
            <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="70" cy="70" r="52" fill="none" stroke="#F0EBF6" strokeWidth="10" />
              <circle cx="70" cy="70" r="52" fill="none" stroke="#5F0080" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 44, color: '#1F1F1F', letterSpacing: '-0.028em', lineHeight: 1 }}>{score}</div>
              <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, fontWeight: 600, color: '#6F6F6F', letterSpacing: '0.08em', marginTop: 4, textTransform: 'uppercase' }}>휴식도</div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 9999, background: '#E6F8F3', color: '#1F8A5B', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>↓ 18% 개선</span>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 15, color: '#1F1F1F', marginTop: 10, letterSpacing: '-0.012em', lineHeight: '22px' }}>
              지난 회차보다
              <br />
              <span style={{ color: '#5F0080' }}>마음이 더 차분</span>해졌어요
            </div>
            <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: '#6F6F6F', marginTop: 6 }}>또래 평균 64 · 최고 95</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ background: '#FFFFFF', borderRadius: 22, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, color: '#1F1F1F', letterSpacing: '-0.012em' }}>세부 지표</div>
          {[
            { n: '이완 (α 파)', v: 74, c: '#5F0080' },
            { n: '집중 (β 파)', v: 68, c: '#875EB3' },
            { n: '균형 (좌·우)', v: 82, c: '#B373EF' },
          ].map((m) => (
            <div key={m.n}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 13, color: '#1F1F1F' }}>{m.n}</div>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, color: '#1F1F1F' }}>{m.v}</div>
              </div>
              <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: '#F0EBF6', overflow: 'hidden' }}>
                <div style={{ width: `${m.v}%`, height: '100%', background: m.c, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '12px 16px 16px' }}>
        <div style={{ background: '#FBF7FE', borderRadius: 22, padding: 18, display: 'flex', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#B373EF,#5F0080)', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, border: '2px solid #FFFFFF', flex: 'none' }}>김</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 13, color: '#1F1F1F' }}>김지수 지도사</span>
              <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#6F6F6F' }}>· 오후 10:14</span>
            </div>
            <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 13, lineHeight: '20px', color: 'rgba(0,0,0,0.7)', margin: '6px 0 0' }}>
              호흡이 길어지면서 이완 지표가 안정되었어요. 내일은 들숨을 5초까지 늘려보면 좋겠습니다.
            </p>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <button className="mb-btn" style={{ width: '100%', height: 50, borderRadius: 16, fontSize: 15 }}>전체 리포트 PDF 보기</button>
      </div>
    </Shell>
  );
}

function ProfileScreen({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <Shell tab={tab} onTab={onTab} top={<TopBar eyebrow="Profile" title="내 정보" />}>
      <div style={{ padding: '8px 16px 16px' }}>
        <div style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #F5EDFC 100%)', borderRadius: 22, padding: 22, position: 'relative', overflow: 'hidden' }}>
          <img src={`${ASSET}/logo_symbol_dark.svg`} alt="" style={{ position: 'absolute', right: -28, bottom: -40, width: 160, opacity: 0.06, transform: 'rotate(-8deg)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative' }}>
            <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'linear-gradient(135deg, #B373EF, #5F0080)', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 24, border: '3px solid #FFFFFF', flex: 'none' }}>민</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 18, color: '#1F1F1F', letterSpacing: '-0.014em' }}>김민지</div>
              <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: '#6F6F6F', marginTop: 4 }}>정기 8주 프로그램 · 4회차</div>
            </div>
          </div>
          <div style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 12, color: '#1F1F1F' }}>프로그램 진척도</div>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 12, color: '#5F0080' }}>50%</div>
            </div>
            <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: '#F0EBF6', overflow: 'hidden' }}>
              <div style={{ width: '50%', height: '100%', background: 'linear-gradient(90deg,#B373EF,#5F0080)', borderRadius: 4 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ width: 26, height: 26, borderRadius: '50%', background: i < 4 ? '#5F0080' : '#FFFFFF', border: i < 4 ? '0' : '1.5px solid #DDDEE7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mb-font-mono)', fontWeight: 700, fontSize: 10, color: i < 4 ? '#FFFFFF' : '#A2A3AD' }}>{i + 1}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[
          { l: '총 명상', v: '8시간', s: '32분' },
          { l: '최고 휴식도', v: '82', s: '5/11' },
          { l: '리포트', v: '12', s: '건' },
        ].map((s) => (
          <div key={s.l} style={{ background: '#FFFFFF', borderRadius: 14, padding: '12px 12px' }}>
            <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 9, color: '#6F6F6F', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{s.l}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 4 }}>
              <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 20, color: '#1F1F1F', letterSpacing: '-0.02em', lineHeight: 1 }}>{s.v}</span>
              <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 10, color: '#6F6F6F' }}>{s.s}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ background: '#FFFFFF', borderRadius: 18 }}>
          {[
            { ico: '🔔', t: '알림 설정', v: '세션 30분 전' },
            { ico: '📅', t: '수업 알림', v: '켜짐' },
            { ico: '🎧', t: '재생 음향', v: '자연음 · 60%' },
            { ico: '🩺', t: 'LINK BAND 연결', v: 'LB-A02E1 · 88%' },
          ].map((it, i, arr) => (
            <div key={it.t} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: i < arr.length - 1 ? '1px solid #F5F5F8' : '0' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#F5EDFC', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 16 }}>{it.ico}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 14, color: '#1F1F1F' }}>{it.t}</div>
              </div>
              <div style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 12, color: '#6F6F6F' }}>{it.v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <button className="mb-btn mb-btn--ghost" style={{ width: '100%', height: 48, fontSize: 13, borderRadius: 14, color: '#D33F3F', borderColor: '#FFD4D2' }}>로그아웃</button>
      </div>
    </Shell>
  );
}

export default function UserAppPage() {
  const [tab, setTab] = useState<Tab>('home');
  let screen: ReactNode;
  switch (tab) {
    case 'class':
      screen = <ClassScreen tab={tab} onTab={setTab} />;
      break;
    case 'session':
      screen = <SessionScreen tab={tab} onTab={setTab} onExit={() => setTab('home')} />;
      break;
    case 'report':
      screen = <ReportScreenV tab={tab} onTab={setTab} back={() => setTab('home')} />;
      break;
    case 'profile':
      screen = <ProfileScreen tab={tab} onTab={setTab} />;
      break;
    default:
      screen = <HomeScreen tab={tab} onTab={setTab} go={setTab} />;
  }
  return (
    <div style={{ minHeight: '100vh', background: '#EBE6E2', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 24, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: -36, left: 4, display: 'flex', gap: 6 }}>
          {(['home', 'class', 'session', 'report', 'profile'] as Tab[]).map((r) => (
            <button key={r} onClick={() => setTab(r)} style={{ background: tab === r ? '#5F0080' : '#FFFFFF', color: tab === r ? '#FFFFFF' : '#5F0080', border: '1px solid #5F0080', borderRadius: 9999, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--mb-font-sans)' }}>{r}</button>
          ))}
        </div>
        {screen}
      </div>
    </div>
  );
}
