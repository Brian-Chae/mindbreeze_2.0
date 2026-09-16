import { Arrow, SectionHeading, secondaryButton, sectionContainer } from './landing-ui';

const specs = [
  { value: '2', unit: '채널', label: '전전두엽 뇌파 측정' },
  { value: '250', unit: 'Hz', label: '뇌파 샘플링' },
  { value: '약 50', unit: 'g', label: '가벼운 착용감' },
];

export default function FeatureCards() {
  return <section className="bg-[#F1ECE7] py-20 sm:py-28">
    <div className={sectionContainer}>
      <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16">
        <div className="relative overflow-hidden rounded-[28px] bg-[#DED6D3]">
          <img src="/mb-design/assets/landing/link-band-1200.webp" srcSet="/mb-design/assets/landing/link-band-600.webp 600w, /mb-design/assets/landing/link-band-1200.webp 1200w" sizes="(max-width: 1023px) 90vw, 550px" width={1200} height={751} loading="lazy" decoding="async" alt="다양한 색상의 LINK BAND 헤드밴드와 이마에 닿는 센서" className="aspect-[4/3] w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-[#2F2438]/85 to-transparent px-6 pb-6 pt-16 text-white"><span className="text-sm font-bold tracking-widest">LINK BAND 2.0</span><span className="rounded-full border border-white/50 px-3 py-1 text-xs">웨어러블 생체신호 센서</span></div>
        </div>
        <div>
          <SectionHeading label="MEET LINK BAND">말로 다 전하지 못한 순간,<br />몸의 신호도 함께 읽어요.</SectionHeading>
          <p className="mt-6 text-base leading-8 text-[#716675]">머리에 가볍게 착용하는 LINK BAND.<br />뇌파와 맥파, 움직임을 함께 기록해 상담과 명상 속 변화를 이해하는 또 하나의 단서를 제공합니다.</p>
          <div className="mt-7 flex flex-wrap gap-2">{['EEG · 뇌파', 'PPG · 맥파', 'ACC · 움직임'].map((label) => <span key={label} className="rounded-full border border-[#DACEDD] px-3 py-2 text-xs font-semibold text-[#66546F]">{label}</span>)}</div>
          <a href="https://linkband.looxidlabs.com/ko" target="_blank" rel="noopener noreferrer" className={`${secondaryButton} mt-8`}>LINK BAND 자세히 보기 <span className="sr-only">(새 창)</span><Arrow diagonal /></a>
        </div>
      </div>
      <dl className="mt-12 grid grid-cols-3 gap-3 border-y border-[#DCD2DF] py-8 sm:gap-6 sm:py-10">{specs.map((spec) => <div key={spec.label} className="text-center"><dt className="text-[11px] text-[#796B80] sm:text-sm">{spec.label}</dt><dd className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#5F0080] sm:text-5xl">{spec.value}<span className="ml-1.5 text-xs font-medium tracking-normal sm:text-base">{spec.unit}</span></dd></div>)}</dl>
      <p className="mt-5 text-xs leading-6 text-[#756779]">제품 사양은 LINK BAND 공식 안내 기준입니다. 웹 기기 연결은 Chrome·Edge 등 Web Bluetooth 지원 브라우저에서 이용하세요. 측정 결과는 자기 이해를 위한 참고 정보입니다.</p>
    </div>
  </section>;
}
