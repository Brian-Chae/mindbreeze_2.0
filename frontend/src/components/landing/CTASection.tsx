const footerCols = [
  { title: '서비스', items: ['심리상담', '명상 클래스', 'AI 리포트', '도입 문의'] },
  { title: '회사', items: ['룩시드랩스', '보도자료', '채용', '개인정보 처리방침'] },
  { title: '지원', items: ['고객센터', '상담사 가이드', 'FAQ', '이용약관'] },
];

export const CTASection: React.FC = () => {
  return (
    <section className="px-8 pb-24 bg-white">
      <div className="max-w-[1280px] mx-auto bg-purple-900 rounded-[48px] px-[60px] py-20 relative overflow-hidden text-white">
        <img
          src="/mb-design/assets/logo_symbol_dark.svg"
          alt=""
          className="absolute pointer-events-none"
          style={{
            right: -60,
            bottom: -80,
            width: 520,
            opacity: 0.18,
            filter: 'brightness(0) invert(1)',
            transform: 'rotate(-8deg)',
          }}
        />
        <div className="relative max-w-[720px]">
          <span className="mb-eyebrow" style={{ background: '#191A1E', color: '#C6AEF6' }}>
            상담사·지도사를 위한 플랫폼
          </span>
          <h2 className="font-sans font-extrabold text-[48px] leading-[60px] tracking-[-0.03em] text-white mt-6 mb-4">
            과학적인 상담·명상 플랫폼을
            <br />
            여러분의 센터에서 시작하세요
          </h2>
          <p className="font-medium text-[17px] leading-[28px] m-0 max-w-[560px]" style={{ color: '#C6AEF6' }}>
            임상 심리상담, 최면 치료, 명상 수업까지. LINK BAND 패키지, AI 기록 시스템, 전문가 교육까지 한 번에 도입하세요.
          </p>
          <div className="flex gap-3 mt-9 flex-wrap">
            <button
              className="mb-btn h-[52px] px-7 text-[16px] rounded-[14px]"
              style={{ background: '#FFFFFF', color: '#5F0080' }}
            >
              도입 문의
            </button>
            <button
              className="mb-btn mb-btn--ghost h-[52px] px-[22px] text-[16px] rounded-[14px]"
              style={{ border: '1px solid rgba(255,255,255,0.4)', color: '#FFFFFF', background: 'transparent' }}
            >
              서비스 안내서 다운로드
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export const Footer: React.FC = () => {
  return (
    <footer className="bg-[#191A1E] text-white px-8 pt-[60px] pb-10">
      <div className="max-w-[1280px] mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-10 items-start">
        <div>
          <div className="flex items-center gap-[10px]">
            <img
              src="/mb-design/assets/logo_symbol_dark.svg"
              width={28}
              height={13}
              alt=""
              style={{ filter: 'brightness(0) invert(1)' }}
            />
            <span className="font-sans font-extrabold text-[18px]">Mind&nbsp;Breeze</span>
          </div>
          <p className="text-[13px] leading-[22px] text-[#A2A3AD] mt-[14px] max-w-[360px]">
            ⓒ Looxid Labs Inc.
            <br />
            서울특별시 성동구 · contact@looxidlabs.com
          </p>
        </div>
        {footerCols.map((col) => (
          <div key={col.title}>
            <div className="font-sans font-bold text-[14px] text-white mb-[14px]">{col.title}</div>
            {col.items.map((it) => (
              <div key={it} className="text-[13px] leading-[26px] text-[#A2A3AD]">
                {it}
              </div>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
};

export default CTASection;
