import { Link } from 'react-router-dom';

const stats = [
  { n: '14', l: '건의 뇌파 특허' },
  { n: '27K', l: '표준 뇌파 데이터' },
  { n: '10K', l: '시간 기능 데이터' },
  { n: 'CES 2×', l: '혁신상 수상' },
];

const Hero: React.FC = () => {
  return (
    <section className="relative min-h-[720px] overflow-hidden bg-[#EBE6E2]">
      <img
        src="/mb-design/assets/images/hero_landing.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-right block"
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, rgba(235,230,226,0.92) 0%, rgba(235,230,226,0.78) 28%, rgba(235,230,226,0.0) 52%)',
        }}
      />
      <div className="relative max-w-[1280px] mx-auto px-8 pt-[120px] pb-24">
        <div className="max-w-[560px]">
          <span className="mb-eyebrow" style={{ background: '#FFFFFF', color: '#5F0080' }}>
            뇌과학 IT기업, 룩시드랩스
          </span>
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
              to="/register"
              className="mb-btn h-[52px] px-7 text-[16px] rounded-[14px] inline-flex items-center"
            >
              무료로 시작하기
            </Link>
            <button
              className="mb-btn mb-btn--ghost h-[52px] px-[22px] text-[16px] rounded-[14px] backdrop-blur-md"
              style={{ background: 'rgba(255,255,255,0.6)' }}
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
};

export default Hero;
