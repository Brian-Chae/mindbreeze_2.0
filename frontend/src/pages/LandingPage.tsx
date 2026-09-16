import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import FeatureCards from '../components/landing/FeatureCards';
import PeopleSection from '../components/landing/PeopleSection';
import ReportPreviewSection from '../components/landing/ReportPreviewSection';
import ProcessSection from '../components/landing/ProcessSection';
import { CTASection, Footer } from '../components/landing/CTASection';
import { Arrow, primaryButton, secondaryButton, sectionContainer } from '../components/landing/landing-ui';

const navItems = [
  { label: '서비스', id: 'service' },
  { label: 'LINK BAND', id: 'link-band' },
  { label: '리포트', id: 'reports' },
  { label: '고객센터', id: 'support' },
] as const;

function LandingNav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggleRef.current?.focus(); }
    };
    const media = window.matchMedia('(min-width: 1280px)');
    const closeOnDesktop = () => { if (media.matches) setOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    media.addEventListener('change', closeOnDesktop);
    return () => { document.removeEventListener('keydown', closeOnEscape); media.removeEventListener('change', closeOnDesktop); };
  }, [open]);
  return <header className="sticky top-0 z-40 border-b border-[#ECE7ED] bg-white/95 backdrop-blur-lg">
    <div className={`${sectionContainer} flex min-h-20 flex-wrap items-center justify-between gap-x-6`}>
      <Link to="/" aria-label="Mind Breeze 홈" className="flex items-center gap-2.5 py-5 text-xl font-extrabold tracking-[-0.04em] text-[#5F0080]">
        <img src="/mb-design/assets/logo_symbol_dark.svg" width={28} height={16} alt="" />Mind Breeze<span className="ml-0.5 text-[10px] font-semibold tracking-normal text-[#827788]">2.0</span>
      </Link>
      <button ref={toggleRef} type="button" aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="landing-navigation" onClick={() => setOpen(!open)} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E4DDE6] text-[#5F0080] xl:hidden">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={open ? 'M6 6l12 12M6 18L18 6' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
      </button>
      <div id="landing-navigation" className={`${open ? 'flex' : 'hidden'} max-h-[calc(100dvh-80px)] w-full flex-col gap-5 overflow-y-auto pb-6 xl:flex xl:w-auto xl:flex-1 xl:flex-row xl:items-center xl:justify-end xl:gap-8 xl:overflow-visible xl:pb-0`}>
        <nav aria-label="메인 메뉴" className="grid grid-cols-2 gap-1 xl:flex xl:gap-0">
          {navItems.map(({ label, id }) => <a key={id} href={`#${id}`} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-sm font-medium text-[#4B4350] transition-colors hover:bg-[#F6F1F8] hover:text-[#5F0080]">{label}</a>)}
        </nav>
        <nav aria-label="서비스 시작" className="flex flex-col gap-2 border-t border-[#ECE7ED] pt-4 xl:flex-row xl:items-center xl:border-0 xl:pt-0">
          <Link to="/join" onClick={() => setOpen(false)} className={secondaryButton}>클래스 바로 참여</Link>
          <Link to="/login" onClick={() => setOpen(false)} className="inline-flex min-h-12 items-center justify-center rounded-full px-4 text-sm font-semibold text-[#49414E] hover:bg-[#F6F1F8]">로그인</Link>
          <Link to="/register" onClick={() => setOpen(false)} className={primaryButton}>회원가입</Link>
        </nav>
      </div>
    </div>
  </header>;
}

function LandingHero() {
  return <section className="overflow-hidden bg-[#F7F4F0]">
    <div className={`${sectionContainer} grid items-center gap-8 pb-14 pt-12 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pb-20 lg:pt-16`}>
      <div className="relative z-10">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#DED3E3] bg-white/70 px-3.5 py-2 text-xs font-semibold text-[#5F0080]"><span className="h-1.5 w-1.5 rounded-full bg-[#5F0080]" />상담과 명상, 사람에게 더 가까이</p>
        <h1 className="mt-7 text-[39px] font-bold leading-[1.25] tracking-[-0.055em] text-[#29212E] sm:text-[56px] lg:text-[64px]">마음을 돌보는 일,<br /><span className="text-[#5F0080]">변화가 보이도록.</span></h1>
        <p className="mt-6 max-w-[470px] text-base leading-8 text-[#68606A] sm:text-lg">기록은 AI에게, 집중은 사람에게.<br />상담과 명상의 순간을 기록하고,<br className="sm:hidden" /> 몸과 마음의 변화를 함께 읽어보세요.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/register" className={primaryButton}>마인드브리즈 시작하기 <Arrow /></Link>
          <a href="#reports" className={secondaryButton}>리포트 먼저 살펴보기 <Arrow diagonal /></a>
        </div>
        <p className="mt-5 text-xs leading-6 text-[#756C78]">상담센터 · 상담사 · 명상가를 위한 통합 플랫폼</p>
      </div>
      <div className="relative mx-auto w-full max-w-[500px] pb-7 pl-6 sm:pl-10">
        <div className="absolute inset-x-8 bottom-10 top-12 rounded-full bg-[#E8DCEC]" aria-hidden="true" />
        <img src="/mb-design/assets/landing/hero-800.webp" srcSet="/mb-design/assets/landing/hero-480.webp 480w, /mb-design/assets/landing/hero-800.webp 800w" sizes="(max-width: 640px) 85vw, 460px" alt="눈을 감고 편안하게 자신의 호흡에 집중하는 사람" width={800} height={1115} loading="lazy" decoding="async" className="relative h-[380px] w-full object-contain sm:h-[490px] lg:h-[540px]" />
        <div className="absolute bottom-0 left-0 max-w-[285px] rounded-2xl border border-white bg-white/95 p-5 shadow-xl shadow-[#5F0080]/5">
          <p className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-[#5F0080]"><span className="h-2 w-2 rounded-full bg-[#70A38B]" />BODY & MIND</p>
          <p className="mt-2 text-lg font-bold tracking-tight text-[#312637]">작은 변화에도,<br />이야기가 있으니까.</p>
          <p className="mt-2 text-xs text-[#796E7E]">나를 이해하는 새로운 기록</p>
        </div>
        <span className="absolute right-0 top-12 rounded-full border border-white/80 bg-white/85 px-4 py-2 text-xs text-[#5F0080]">기술이 돕고, 사람이 돌봅니다</span>
      </div>
    </div>
    <div className="border-t border-[#E5DDE5]">
      <div className={`${sectionContainer} grid grid-cols-1 gap-3 py-6 text-center text-sm text-[#625667] sm:grid-cols-3 sm:gap-6`}>
        <p><span className="mr-2 text-[#5F0080]">01</span>AI 상담 기록·요약</p><p><span className="mr-2 text-[#5F0080]">02</span>선택형 생체신호 측정</p><p><span className="mr-2 text-[#5F0080]">03</span>몸·마음 서사형 리포트</p>
      </div>
    </div>
  </section>;
}

export default function LandingPage() {
  return <div className="min-h-screen break-keep bg-white font-sans text-[#29212E]">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:p-4 focus:text-[#5F0080]">본문으로 건너뛰기</a>
    <LandingNav />
    <main id="main-content" tabIndex={-1}><LandingHero /><div id="service" className="scroll-mt-24"><PeopleSection /></div><div id="link-band" className="scroll-mt-24"><FeatureCards /></div><div id="reports" className="scroll-mt-24"><ReportPreviewSection /></div><ProcessSection /><div id="support" className="scroll-mt-24"><CTASection /></div></main>
    <Footer />
  </div>;
}
