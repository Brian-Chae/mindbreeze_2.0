interface FeatureCard {
  img: string;
  alt: string;
  eyebrow: string;
  title: React.ReactNode;
  body: React.ReactNode;
}

const cards: FeatureCard[] = [
  {
    img: '/mb-design/assets/images/feature_link_headbands.png',
    alt: 'LINK BAND 5종 컬러',
    eyebrow: 'HARDWARE · LINK BAND',
    title: '머리에 닿는 순간, 뇌파를 읽습니다',
    body: (
      <>
        의료용 등급 센서를 헤드밴드 한 줄에 담았습니다.
        <br />
        5가지 컬러, 가벼운 무게로 누구나 부담 없이 착용합니다.
      </>
    ),
  },
  {
    img: '/mb-design/assets/images/feature_inhale_mountain.png',
    alt: 'inhale — 호흡 가이드',
    eyebrow: 'AI · AUTO RECORD',
    title: (
      <>
        상담 내용을 AI가 기록하고
        <br />
        인사이트를 찾아냅니다
      </>
    ),
    body: (
      <>
        음성 녹음부터 STT 변환, AI 요약까지 자동.
        <br />
        상담사는 사람에게만 집중하고 기록은 AI에게 맡기세요.
      </>
    ),
  },
];

const FeatureCards: React.FC = () => {
  return (
    <section className="bg-[#EBE6E2] px-8 pb-24">
      <div className="max-w-[1280px] mx-auto">
        <div className="mb-8">
          <span className="mb-eyebrow" style={{ background: '#FFFFFF', color: '#5F0080' }}>
            MIND BREEZE 2.0
          </span>
          <h2 className="font-sans font-bold text-[36px] leading-[46px] tracking-[-0.028em] text-gray-950 mt-4 max-w-[720px]">
            뇌파 측정과 AI 분석, 두 축으로 완성되는 멘탈 케어
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {cards.map((c, i) => (
            <article key={i} className="bg-white rounded-[28px] overflow-hidden flex flex-col">
              <div className="aspect-[16/9] overflow-hidden">
                <img src={c.img} alt={c.alt} className="w-full h-full object-cover block" />
              </div>
              <div className="px-8 pt-8 pb-9">
                <div className="text-[12px] font-semibold tracking-[0.12em] text-purple-900 uppercase">
                  {c.eyebrow}
                </div>
                <h3 className="font-sans font-bold text-[24px] leading-[32px] text-gray-950 mt-[10px] mb-2 tracking-[-0.02em]">
                  {c.title}
                </h3>
                <p className="font-medium text-[15px] leading-[26px] text-black/60 m-0">{c.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeatureCards;
