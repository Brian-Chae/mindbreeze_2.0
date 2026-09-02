import { useState } from 'react';
import { Link } from 'react-router-dom';
import FeatureCards from '../components/landing/FeatureCards';
import PeopleSection from '../components/landing/PeopleSection';
import ProcessSection from '../components/landing/ProcessSection';
import { CTASection, Footer } from '../components/landing/CTASection';

const navItems = ['서비스', 'AI 리포트', '상담사', '고객센터'] as const;

const stats = [
  { n: '14', l: '건의 뇌파 특허' },
  { n: '27K', l: '표준 뇌파 데이터' },
  { n: '10K', l: '시간 기능 데이터' },
  { n: 'CES 2×', l: '혁신상 수상' },
];

function BuildingIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LandingNav() {
  const [active, setActive] = useState<string>('서비스');

  return (
    <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#EFEFEF]">
      <div className="max-w-[1280px] mx-auto px-8 py-[18px] flex items-center justify-between gap-8">
        <a href="#" className="flex items-center gap-3 no-underline">
          <img src="/mb-design/assets/logo_symbol_dark.svg" width={28} height={13} alt="" />
          <span className="font-sans font-extrabold text-[19px] text-purple-900 tracking-[-0.02em]">
            Mind&nbsp;Breeze
          </span>
        </a>
        <div className="hidden md:flex gap-1 items-center">
          {navItems.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setActive(label)}
              className={`bg-transparent border-0 px-[18px] py-[10px] font-sans text-[15px] cursor-pointer ${
                active === label ? 'font-bold text-purple-900' : 'font-medium text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-[10px]">
          <Link
            to="/join"
            className="mb-btn mb-btn--ghost h-10 px-4 text-[14px] whitespace-nowrap inline-flex items-center"
          >
            클래스 참여
          </Link>
          <Link
            to="/login"
            className="mb-btn mb-btn--ghost h-10 px-4 text-[14px] whitespace-nowrap inline-flex items-center"
          >
            상담사 로그인
          </Link>
          <Link
            to="/login/client"
            className="mb-btn mb-btn--ghost h-10 px-4 text-[14px] whitespace-nowrap inline-flex items-center"
          >
            회원 로그인
          </Link>
          <Link
            to="/login"
            className="mb-btn h-10 px-[18px] text-[14px] whitespace-nowrap inline-flex items-center gap-2"
          >
            <BuildingIcon />
            기관로그인
          </Link>
        </div>
      </div>
    </nav>
  );
}

function LandingHero() {
  return (
    <section className="relative min-h-[720px] overflow-hidden bg-[#EBE6E2]">
      <img
        src="/mb-design/assets/images/hero_landing.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-right block"
      />
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-[#EBE6E2]/92 via-[#EBE6E2]/78 to-transparent" />
      <div className="relative max-w-[1280px] mx-auto px-8 pt-[120px] pb-24">
        <div className="max-w-[560px]">
          <span className="mb-eyebrow bg-white text-[#5F0080]">뇌과학 IT기업, 룩시드랩스</span>
          <h1 className="font-sans font-bold text-[60px] leading-[72px] tracking-[-0.034em] text-gray-950 mt-7">
            마음을 과학으로
            <br />
            <span className="text-purple-900">이해하는 순간</span>
          </h1>
          <p className="font-medium text-[18px] leading-[30px] text-black/60 max-w-[480px] mt-7">
            LINK BAND가 뇌파를 측정하고 AI가 분석합니다.
            <br />
            상담사는 기록에서 자유로워지고 내담자에게 집중할 수 있습니다.
          </p>
          <div className="flex gap-3 mt-9 flex-wrap">
            <Link
              to="/login"
              className="mb-btn h-[52px] px-7 text-[16px] rounded-[14px] inline-flex items-center gap-2"
            >
              <BuildingIcon />
              기관로그인
            </Link>
            <Link
              to="/join"
              className="mb-btn mb-btn--ghost h-[52px] px-[22px] text-[16px] rounded-[14px] inline-flex items-center backdrop-blur-md"
            >
              클래스 코드로 참여
            </Link>
            <button
              type="button"
              className="mb-btn mb-btn--ghost h-[52px] px-[22px] text-[16px] rounded-[14px] backdrop-blur-md bg-white/60"
            >
              서비스 알아보기 →
            </button>
          </div>
          <div className="mt-16 flex gap-9 items-baseline flex-wrap">
            {stats.map((s) => (
              <div key={s.l}>
                <div className="font-sans font-bold text-[28px] tracking-[-0.02em] text-gray-950 leading-[32px]">
                  {s.n}
                </div>
                <div className="font-medium text-[13px] text-black/60 mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <LandingNav />
      <LandingHero />
      <FeatureCards />
      <PeopleSection />
      <ProcessSection />
      <CTASection />
      <Footer />
    </div>
  );
};

export default LandingPage;
