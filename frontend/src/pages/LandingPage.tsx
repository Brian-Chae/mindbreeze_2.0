import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';

/* ─── 정적 데이터 ─── */

const features = [
  {
    icon: '◉',
    title: 'AI 기반 자동 기록',
    desc: '상담·명상 세션의 모든 대화를 AI가 실시간으로 기록하고 요약합니다. 상담사는 기록에서 자유로워지고, 내담자에게 더 집중할 수 있습니다.',
    color: 'accent-cool',
  },
  {
    icon: '⌬',
    title: 'LINK BAND 뇌파 연동',
    desc: '실시간 뇌파(EEG)로 내담자의 집중도·이완도·스트레스 지수를 과학적으로 측정합니다. 눈에 보이지 않던 마음의 상태를 데이터로 확인하세요.',
    color: 'brand-primary',
  },
  {
    icon: '◈',
    title: '신뢰 기반 플랫폼',
    desc: '상담사의 자격증·사업자등록 진위를 AI가 자동 검증합니다. 검증된 전문가와 안전하게 연결되는 투명한 생태계를 만듭니다.',
    color: 'accent-warm',
  },
];

const steps = [
  {
    step: '01',
    title: '연결',
    desc: 'LINK BAND를 착용하고\n세션을 시작하세요.\n착용은 선택입니다.',
  },
  {
    step: '02',
    title: '기록',
    desc: '대화는 AI가 실시간으로\n텍스트로 변환하고\n요약을 생성합니다.',
  },
  {
    step: '03',
    title: '인사이트',
    desc: '뇌파 데이터 + 대화 요약으로\n객관적인 리포트를\n자동 생성합니다.',
  },
];

const audiences = [
  {
    label: '상담사 · 코치',
    points: [
      '세션 기록 자동화로 행정 부담 제로',
      '뇌파 데이터로 내담자 상태 객관적 파악',
      'AI 요약으로 슈퍼비전·사례 연구 효율화',
      '검증된 프로필로 신규 내담자 유입',
    ],
    cta: '상담사로 시작하기',
    bg: 'surface-elevated',
  },
  {
    label: '내담자 · 명상가',
    points: [
      '나의 마음 상태를 과학적으로 이해',
      '상담 내용을 잊지 않도록 자동 기록',
      '검증된 전문가와 안전하게 매칭',
      '나만의 명상·이완 데이터 트래킹',
    ],
    cta: '무료로 시작하기',
    bg: 'brand-deep',
    inverted: true,
  },
];

const trustItems = [
  {
    icon: '⬡',
    title: '자격 검증',
    desc: 'AI가 상담사 자격증·사업자등록의 진위를\n실시간으로 확인합니다.',
  },
  {
    icon: '⬢',
    title: '데이터 보안',
    desc: '모든 상담 데이터는 암호화되어 저장되며,\n접근 권한은 내담자가 통제합니다.',
  },
  {
    icon: '◈',
    title: '프라이버시 중심',
    desc: '뇌파·음성 데이터는 명시적 동의 하에만\n수집되며, 보관 기간을 직접 설정합니다.',
  },
];

const footerLinks = {
  서비스: ['상담사', '내담자', '명상', '요금제'],
  회사: ['소개', '블로그', '채용', '문의'],
  리소스: ['도움말', 'API', '연구', '파트너'],
};

/* ─── 헬퍼 ─── */

const colorMap: Record<string, string> = {
  'accent-cool': 'bg-accent-cool text-slate-800',
  'brand-primary': 'bg-brand-primary text-white',
  'accent-warm': 'bg-accent-warm text-slate-800',
};

const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

/* ─── 컴포넌트 ─── */

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-surface-canvas text-ink-primary font-body">
      {/* ─── Nav ─── */}
      <nav
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-surface-canvas/90 backdrop-blur-md border-b border-border-subtle'
            : 'bg-transparent'
        }`}
      >
        <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between">
          <Link
            to="/"
            className={`font-display text-xl font-light tracking-tight transition-colors duration-300 ${
              scrolled ? 'text-ink-primary' : 'text-white'
            }`}
          >
            Mind Breeze
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle inverted={!scrolled} />
            <Link
            to="/login"
            className={`inline-flex items-center h-9 px-5 rounded-pill border text-sm font-medium transition-all duration-300 ${
              scrolled
                ? 'border-border-default hover:border-brand-primary hover:text-brand-primary text-ink-primary'
                : 'border-white/25 hover:border-white/50 text-white'
            }`}
          >
            로그인
          </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-brand-deep">
        {/* 배경 텍스처 */}
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage: `radial-gradient(circle at 30% 40%, #88a887 0%, transparent 50%),
                             radial-gradient(circle at 70% 60%, #e8b4a0 0%, transparent 40%),
                             radial-gradient(circle at 50% 80%, #a5c5d6 0%, transparent 45%)`,
          }}
        />

        {/* Breath Circle 배경 장식 */}
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
          <div className="breath-circle" style={{ '--breath-circle-size': '480px' } as React.CSSProperties}>
            <div className="breath-ring breath-ring--outer" />
            <div className="breath-ring breath-ring--middle" />
            <div className="breath-ring breath-ring--inner" />
          </div>
        </div>

        <div className="relative z-10 text-center px-5 max-w-3xl">
          <p className="text-accent-warm text-sm font-semibold tracking-widest uppercase mb-6">
            Clinical Garden — Mind Breeze
          </p>
          <h1 className="font-korean text-5xl sm:text-6xl lg:text-7xl font-light text-white tracking-tight leading-tight">
            과학으로 검증된
            <br />
            <span className="text-[#d4956b]">평온함</span>
          </h1>
          <p className="mt-8 text-lg sm:text-xl text-white/85 leading-relaxed max-w-xl mx-auto">
            AI가 상담을 기록하고, 뇌파가 마음을 증명하며,
            <br />
            당신이 온전히 사람에게 집중합니다.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register/counselor"
              className="inline-flex items-center justify-center h-12 px-8 rounded-pill bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-active text-ink-on-brand font-semibold shadow-lg transition-all duration-150"
            >
              상담사 가입
            </Link>
            <Link
              to="/register/client"
              className="inline-flex items-center justify-center h-12 px-8 rounded-pill bg-accent-warm hover:bg-[#dba590] active:bg-[#ce9778] text-slate-800 font-semibold shadow-lg shadow-accent-warm/20 transition-all duration-150"
            >
              무료로 시작하기
            </Link>
            <a
              href="#how"
              className="inline-flex items-center justify-center h-12 px-8 rounded-pill border border-white/30 hover:border-white/60 text-white/90 hover:text-white font-medium transition-all duration-150"
            >
              더 알아보기
            </a>
          </div>
        </div>

        {/* 하단 스크롤 인디케이터 */}
        <div className="absolute bottom-8 inset-x-0 flex justify-center">
          <div className="animate-bounce opacity-40">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </section>

      {/* ─── 핵심 가치 ─── */}
      <section className="py-24 sm:py-32 px-5">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-base font-semibold text-accent-warm tracking-widest uppercase mb-3">
            왜 Mind Breeze 인가
          </p>
          <h2 className="font-korean text-3xl sm:text-4xl font-medium text-center text-ink-primary tracking-tight">
            상담이 가벼워집니다
          </h2>
          <p className="mt-4 text-center text-ink-secondary max-w-lg mx-auto">
            기록·측정·검증을 AI가 대신합니다. 당신은 사람에게만 집중하세요.
          </p>

          <div className="mt-16 grid sm:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl bg-surface-elevated border border-border-subtle hover:border-accent-warm/40 hover:shadow-md p-8 transition-all duration-300"
              >
                <div
                  className={`inline-flex items-center justify-center w-14 h-14 rounded-xl text-xl ${
                    colorMap[f.color] || 'bg-slate-100'
                  }`}
                >
                  {f.icon}
                </div>
                <h3 className="mt-5 font-korean text-lg font-semibold text-ink-primary">{f.title}</h3>
                <p className="mt-3 text-sm text-ink-secondary leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how" className="py-24 sm:py-32 px-5 bg-surface-sunken">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-base font-semibold text-accent-warm tracking-widest uppercase mb-3">
            간단한 3단계
          </p>
          <h2 className="font-korean text-3xl sm:text-4xl font-medium text-center text-ink-primary tracking-tight">
            연결하고, 기록하고, 이해합니다
          </h2>

          <div className="mt-16 grid sm:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <div key={s.step} className="relative text-center">
                {/* 연결선 */}
                {i < steps.length - 1 && (
                  <div className="hidden sm:block absolute top-10 left-[calc(50%+3rem)] w-[calc(100%-6rem)] h-px bg-border-default" />
                )}
                <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-surface-canvas border-2 border-accent-warm/30 text-accent-warm font-korean text-2xl font-semibold">
                  {s.step}
                </div>
                <h3 className="mt-5 font-korean text-xl font-semibold text-ink-primary">{s.title}</h3>
                <p className="mt-3 text-sm text-ink-secondary leading-relaxed whitespace-pre-line">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 대상 ─── */}
      <section className="py-24 sm:py-32 px-5">
        <div className="mx-auto max-w-5xl grid sm:grid-cols-2 gap-6">
          {audiences.map((a) => (
            <div
              key={a.label}
              className={`rounded-2xl p-10 sm:p-12 ${
                a.inverted
                  ? 'bg-brand-deep text-white'
                  : 'bg-surface-elevated border border-border-subtle'
              }`}
            >
              <p
                className={`text-sm font-semibold tracking-widest uppercase mb-4 ${
                  a.inverted ? 'text-accent-warm' : 'text-brand-primary'
                }`}
              >
                대상
              </p>
              <h3
                className={`font-korean text-2xl font-semibold ${
                  a.inverted ? 'text-white' : 'text-ink-primary'
                }`}
              >
                {a.label}
              </h3>
              <ul className="mt-6 space-y-3">
                {a.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm leading-relaxed">
                    <span className={`mt-0.5 shrink-0 text-lg ${a.inverted ? 'text-accent-warm' : 'text-leaf-500'}`}>
                      ◆
                    </span>
                    <span className={a.inverted ? 'text-white/90' : 'text-ink-secondary'}>{p}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/register"
                className={`inline-flex items-center justify-center h-11 px-6 rounded-pill mt-8 text-sm font-medium transition-all duration-150 ${
                  a.inverted
                    ? 'bg-accent-warm hover:bg-[#dba590] text-slate-800'
                    : 'bg-brand-primary hover:bg-brand-primary-hover text-white'
                }`}
              >
                {a.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 신뢰 ─── */}
      <section className="py-24 sm:py-32 px-5 bg-surface-elevated">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-base font-semibold text-accent-warm tracking-widest uppercase mb-3">
            안심하세요
          </p>
          <h2 className="font-korean text-3xl sm:text-4xl font-medium text-center text-ink-primary tracking-tight">
            신뢰 위에 설계되었습니다
          </h2>

          <div className="mt-16 grid sm:grid-cols-3 gap-6">
            {trustItems.map((t) => (
              <div key={t.title} className="text-center px-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-warm-subtle text-accent-warm text-2xl">
                  {t.icon}
                </div>
                <h3 className="mt-4 font-korean text-base font-semibold text-ink-primary">{t.title}</h3>
                <p className="mt-2 text-sm text-ink-secondary leading-relaxed whitespace-pre-line">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-24 sm:py-32 px-5 bg-brand-deep text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="font-korean text-3xl sm:text-4xl font-medium text-white tracking-tight">
            오늘, 마음의 평화를
            <br />
            과학으로 만나보세요
          </h2>
          <p className="mt-5 text-white/75 leading-relaxed">
            첫 30일 무료. 신용카드 없이 시작할 수 있습니다.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register"
              className="inline-flex items-center justify-center h-12 px-8 rounded-pill bg-accent-warm hover:bg-[#dba590] active:bg-[#ce9778] text-slate-800 font-semibold shadow-lg shadow-accent-warm/20 transition-all duration-150"
            >
              무료로 시작하기
            </Link>
            <a
              href="mailto:support@looxidlabs.com"
              className="inline-flex items-center justify-center h-12 px-8 rounded-pill border border-white/30 hover:border-white/60 text-white/85 hover:text-white font-medium transition-all duration-150"
            >
              문의하기
            </a>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="py-16 px-5 bg-surface-sunken border-t border-border-subtle">
        <div className="mx-auto max-w-5xl">
          <div className="grid sm:grid-cols-4 gap-8 mb-12">
            <div>
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToTop();
                }}
                className="font-display text-lg font-light text-ink-primary tracking-tight"
              >
                Mind Breeze
              </a>
              <p className="mt-3 text-xs text-ink-tertiary leading-relaxed">
                과학으로 검증된 평온함.
                <br />
                AI · 뇌파 · 상담의 만남.
              </p>
            </div>
            {Object.entries(footerLinks).map(([category, links]) => (
              <div key={category}>
                <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wider mb-3">{category}</p>
                <ul className="space-y-2">
                  {links.map((l) => (
                    <li key={l}>
                      <a
                        href="#"
                        onClick={(e) => e.preventDefault()}
                        className="text-sm text-ink-secondary hover:text-brand-primary transition-colors"
                      >
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="pt-8 border-t border-border-subtle flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <p className="text-xs text-ink-tertiary">
              © 2026 주식회사 룩시드랩스. 대표이사 채용욱. 사업자등록번호 230-81-10210.
              <br />
              대전광역시 유성구 테크노9로 35, 3층 303호 · support@looxidlabs.com
            </p>
            <div className="flex gap-4">
              <a href="#" onClick={(e) => e.preventDefault()} className="text-xs text-ink-tertiary hover:text-brand-primary transition-colors">
                개인정보처리방침
              </a>
              <a href="#" onClick={(e) => e.preventDefault()} className="text-xs text-ink-tertiary hover:text-brand-primary transition-colors">
                이용약관
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
