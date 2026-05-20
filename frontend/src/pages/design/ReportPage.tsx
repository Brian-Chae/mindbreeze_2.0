import type { ReactNode } from 'react';

const ASSET = '/mb-design/assets';

function Cover() {
  const name = '채이서';
  const date = '2024.12.04';
  const session = '마음챙김 입문 · 4주차';
  const score = 74;
  return (
    <div style={{ position: 'relative', width: '100%', borderRadius: 28, overflow: 'hidden', background: 'radial-gradient(120% 80% at 80% 0%, #7D3399 0%, #5F0080 45%, #3A004F 100%)', padding: '32px 28px 28px', color: '#FFFFFF', boxShadow: '0 12px 30px rgba(95,0,128,0.18)' }}>
      <img src={`${ASSET}/logo_symbol_dark.svg`} alt="" style={{ position: 'absolute', right: -64, bottom: -80, width: 360, opacity: 0.1, filter: 'brightness(0) invert(1)', transform: 'rotate(-6deg)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={`${ASSET}/logo_symbol_dark.svg`} width="28" height="13" alt="" style={{ filter: 'brightness(0) invert(1)' }} />
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>MIND&nbsp;BREEZE</div>
        </div>
        <div style={{ fontFamily: 'var(--mb-font-mono)', fontWeight: 500, fontSize: 11, color: '#C6AEF6', letterSpacing: '0.08em' }}>{date}</div>
      </div>
      <div style={{ position: 'relative', marginTop: 28 }}>
        <div style={{ fontFamily: 'var(--mb-font-mono)', fontWeight: 600, fontSize: 11, color: '#C6AEF6', letterSpacing: '0.12em', textTransform: 'uppercase' }}>AI brain wellness report</div>
        <h1 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 34, lineHeight: '42px', letterSpacing: '-0.028em', color: '#FFFFFF', margin: '10px 0 0' }}>
          {name}님의<br />두뇌건강 리포트
        </h1>
      </div>
      <div style={{ position: 'relative', marginTop: 28, display: 'flex', alignItems: 'flex-end', gap: 14 }}>
        <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 96, lineHeight: '84px', letterSpacing: '-0.06em', color: '#FFFFFF' }}>{score}</div>
        <div style={{ paddingBottom: 14 }}>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#C6AEF6', letterSpacing: '0.1em', textTransform: 'uppercase' }}>brain wellness</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '5px 10px', borderRadius: 9999, background: '#01F0C8', color: '#1A2E2A', fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 12 }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 14 12 8 18 14" /></svg>
            평균 +10
          </div>
        </div>
      </div>
      <div style={{ position: 'relative', marginTop: 28, paddingTop: 18, borderTop: '1px solid rgba(198,174,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#C6AEF6', letterSpacing: '0.08em', textTransform: 'uppercase' }}>session</div>
          <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, color: '#FFFFFF', marginTop: 4 }}>{session}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#C6AEF6', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#01F0C8', display: 'inline-block' }} />
          AI 분석 완료
        </div>
      </div>
    </div>
  );
}

function Section({ eyebrow, title, body, children, tone = 'light' }: { eyebrow: string; title: string; body?: string; children?: ReactNode; tone?: 'light' | 'dark' }) {
  const isDark = tone === 'dark';
  return (
    <section style={{ width: '100%', borderRadius: 24, padding: '28px 24px', background: isDark ? '#191A1E' : '#FFFFFF', color: isDark ? '#FFFFFF' : '#1F1F1F', border: isDark ? 'none' : '1px solid #EFEFEF', boxShadow: isDark ? 'none' : '0 4px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ fontFamily: 'var(--mb-font-mono)', fontWeight: 600, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: isDark ? '#C6AEF6' : '#875EB3' }}>{eyebrow}</div>
      <h2 style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 22, lineHeight: '30px', letterSpacing: '-0.018em', margin: '10px 0 0', color: isDark ? '#FFFFFF' : '#1F1F1F' }}>{title}</h2>
      {body && <p style={{ fontFamily: 'var(--mb-font-text)', fontWeight: 500, fontSize: 14, lineHeight: '22px', color: isDark ? '#C6AEF6' : '#6F6F6F', margin: '12px 0 0' }}>{body}</p>}
      {children && <div style={{ marginTop: 22 }}>{children}</div>}
    </section>
  );
}

function Gauge({ value, label, sub, color = '#5F0080', max = 100 }: { value: number; label: string; sub?: string; color?: string; max?: number }) {
  const c = 2 * Math.PI * 90;
  const pct = value / max;
  const dash = c * 0.5 * pct;
  const remain = c * 0.5 - dash;
  return (
    <div style={{ position: 'relative', width: 220, height: 130 }}>
      <svg viewBox="0 0 220 130" width="220" height="130">
        <path d="M 20 110 A 90 90 0 0 1 200 110" stroke="#F2F3F8" strokeWidth="20" fill="none" strokeLinecap="round" />
        <path d="M 20 110 A 90 90 0 0 1 200 110" stroke={color} strokeWidth="20" fill="none" strokeLinecap="round" strokeDasharray={`${dash} ${remain + 1000}`} />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 56, textAlign: 'center', fontFamily: 'var(--mb-font-sans)', fontWeight: 800, fontSize: 44, color: '#1F1F1F', letterSpacing: '-0.04em' }}>{value}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 102, textAlign: 'center', fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      {sub && <div style={{ position: 'absolute', left: 0, right: 0, top: 122, textAlign: 'center', fontFamily: 'var(--mb-font-text)', fontSize: 12, color: '#1F1F1F' }}>{sub}</div>}
    </div>
  );
}

function HBar({ label, value, color = '#5F0080', note, max = 100 }: { label: string; value: number; color?: string; note?: string; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 13, color: '#1F1F1F' }}>{label}</span>
        <span style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 14, color: '#1F1F1F', whiteSpace: 'nowrap' }}>
          {value}
          <span style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F', marginLeft: 4 }}>/ {max}</span>
        </span>
      </div>
      <div style={{ height: 10, background: '#F2F3F8', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 5 }} />
      </div>
      {note && <div style={{ fontFamily: 'var(--mb-font-text)', fontSize: 12, color: '#6F6F6F' }}>{note}</div>}
    </div>
  );
}

function LineChart({ data, color = '#5F0080' }: { data: number[]; color?: string }) {
  const w = 320;
  const h = 110;
  const pad = 8;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const step = (w - pad * 2) / (data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / Math.max(1, max - min)) * (h - pad * 2);
    return `${x},${y}`;
  });
  const path = 'M' + points.join(' L');
  const fill = `M${points[0]} L${points.join(' L')} L${pad + (data.length - 1) * step},${h - pad} L${pad},${h - pad} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        <defs>
          <linearGradient id="rep-lc" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={fill} fill="url(#rep-lc)" />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((v, i) => (
          <circle key={i} cx={pad + i * step} cy={pad + (1 - (v - min) / Math.max(1, max - min)) * (h - pad * 2)} r={i === data.length - 1 ? 4 : 2.5} fill={color} />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#6F6F6F', marginTop: 6 }}>
        <span>0:00</span><span>5:00</span><span>10:00</span><span>15:00</span><span>20:00</span>
      </div>
    </div>
  );
}

export default function ReportPage() {
  const attention = [42, 48, 55, 60, 64, 58, 66, 72, 70, 76, 78, 74, 80, 78, 82, 84];
  return (
    <main style={{ minHeight: '100vh', background: '#EBE6E2', padding: '32px 24px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 412, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Cover />
        <Section eyebrow="introduction" title="이 리포트가 측정하는 것" body="명상 세션 동안 측정된 뇌파(EEG)를 룩시드랩스의 AI 모델로 분석하여 스트레스, 주의, 균형 세 가지 지표로 정리합니다. 본 리포트는 의료 진단이 아닌 두뇌건강 관리 목적의 참고 자료입니다." />
        <Section eyebrow="summary" title="오늘의 두뇌건강 지수">
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <Gauge value={74} label="휴식도" sub="평균 64 · ▲ +10" color="#5F0080" />
          </div>
          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <HBar label="이완 (α파)" value={72} color="#59CE90" note="안정된 휴식 상태가 잘 유지되었습니다." />
            <HBar label="주의 (β파)" value={61} color="#5F0080" note="중간 수준의 집중을 유지했습니다." />
            <HBar label="몰입 (γ파)" value={48} color="#7878FA" note="후반부에 깊은 몰입이 관찰되었습니다." />
          </div>
        </Section>
        <Section eyebrow="stress" title="스트레스 지표" body="세션 후반부로 갈수록 스트레스 지표가 안정 영역으로 진입했습니다.">
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Gauge value={38} label="스트레스 지수" sub="낮음 (0–40)" color="#59CE90" />
          </div>
          <div style={{ marginTop: 18, padding: '14px 16px', background: '#F0F9F5', borderRadius: 12, fontFamily: 'var(--mb-font-text)', fontSize: 13, lineHeight: '20px', color: '#1F1F1F' }}>
            <b style={{ color: '#5E704F' }}>안내</b>
            <br />
            7일 평균 대비 12% 낮은 수치입니다. 호흡 기반 명상을 주 3회 이상 지속해 보세요.
          </div>
        </Section>
        <Section eyebrow="attention" title="주의력 추이" body="20분 세션 동안 주의력이 점진적으로 향상되었습니다.">
          <LineChart data={attention} color="#5F0080" />
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between' }}>
            {[
              { l: '최고', v: '84' },
              { l: '평균', v: '67' },
              { l: '변동성', v: '낮음' },
            ].map((m) => (
              <div key={m.l}>
                <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#6F6F6F' }}>{m.l}</div>
                <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 20, color: '#1F1F1F' }}>{m.v}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section eyebrow="balance" title="좌·우 뇌 균형도" body="좌·우 반구의 활동량이 균형적으로 분포했습니다.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <HBar label="좌반구 활동" value={48} color="#B373EF" />
            <HBar label="우반구 활동" value={52} color="#5F0080" />
            <HBar label="균형도" value={92} color="#59CE90" note="0.92 · 매우 균형적" />
          </div>
        </Section>
        <Section eyebrow="next" title="다음 세션 권장" body="호흡 위주의 입문 단계를 한 단계 더 진행하기를 권합니다.">
          <div style={{ marginTop: 4, padding: '16px 16px', background: '#F5EDFC', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 11, color: '#5F0080', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>recommended · 4주차 후반</div>
              <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 12, color: '#5F0080' }}>30분</div>
            </div>
            <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 700, fontSize: 18, lineHeight: '24px', color: '#1F1F1F', letterSpacing: '-0.012em' }}>마음챙김 입문 · 호흡 가이드</div>
            <div style={{ display: 'flex', gap: 16, paddingTop: 4, borderTop: '1px solid rgba(95,0,128,0.12)' }}>
              {[
                { l: 'focus', v: '호흡 · 이완' },
                { l: 'level', v: '입문 · 2단계' },
                { l: 'guide', v: '김지수 지도사' },
              ].map((m) => (
                <div key={m.l} style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--mb-font-mono)', fontSize: 10, color: '#6F6F6F', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{m.l}</div>
                  <div style={{ fontFamily: 'var(--mb-font-sans)', fontWeight: 600, fontSize: 13, color: '#1F1F1F', marginTop: 4 }}>{m.v}</div>
                </div>
              ))}
            </div>
          </div>
          <button className="mb-btn" style={{ marginTop: 12, width: '100%', height: 44, borderRadius: 12, fontSize: 14 }}>세션 예약하기</button>
        </Section>
      </div>
    </main>
  );
}
