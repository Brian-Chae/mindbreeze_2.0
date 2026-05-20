const people = [
  { src: 'portrait_01_warm_sweater.png', label: '상담 내담자', tag: '심리 상담' },
  { src: 'portrait_02_young_man_concrete.png', label: '명상 참여자', tag: '마음챙김' },
  { src: 'portrait_03_woman_robe.png', label: '스트레스 직장인', tag: '스트레스 관리' },
  { src: 'portrait_04_young_man_warm.png', label: '불면증', tag: '수면의 질' },
  { src: 'portrait_05_woman_sunset_white.png', label: 'ADHD', tag: '집중력 회복' },
  { src: 'portrait_06_woman_purple_sunset.png', label: '시니어 우울', tag: '정서 케어' },
];

const PeopleSection: React.FC = () => {
  return (
    <section className="bg-white px-8 py-[120px]">
      <div className="max-w-[1280px] mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-end mb-14">
          <div>
            <span className="mb-eyebrow">누구나, 어떤 고민이든</span>
            <h2 className="font-sans font-bold text-[42px] leading-[54px] tracking-[-0.0336em] text-gray-950 mt-5">
              심리상담부터 명상까지,
              <br />
              과학으로 증명하는 변화
            </h2>
          </div>
          <p className="font-medium text-[16px] leading-[28px] text-black/60 m-0 pb-[6px]">
            MIND BREEZE는 임상 심리상담, 최면 치료, 명상 수업까지 지원합니다. 전문가의 방식은 달라도, 뇌가 말해주는 진실은 하나입니다.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-[14px]">
          {people.map((p) => (
            <figure key={p.src} className="m-0 relative">
              <div className="aspect-[5/7] overflow-hidden rounded-[18px] bg-[#EBE6E2]">
                <img
                  src={`/mb-design/assets/images/${p.src}`}
                  alt={p.label}
                  className="w-full h-full object-cover block"
                />
              </div>
              <figcaption className="mt-3 flex justify-between items-baseline">
                <span className="font-sans font-bold text-[14px] text-gray-950 tracking-[-0.01em]">
                  {p.label}
                </span>
                <span className="font-medium text-[12px] text-black/50">{p.tag}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PeopleSection;
