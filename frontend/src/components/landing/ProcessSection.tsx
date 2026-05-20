const steps = [
  { n: '01', title: '세션 예약', body: '내담자·참여자와 상담 또는 명상 세션 일정을 잡고 LINK BAND 사용 여부를 선택합니다.' },
  { n: '02', title: '세션 진행', body: '오프라인·온라인 세션에서 음성 녹음과 (선택적) 실시간 뇌파를 측정합니다.' },
  { n: '03', title: 'AI 기록·분석', body: '음성은 STT·요약으로, 뇌파는 학습 모델로 자동 해석되어 인사이트가 정리됩니다.' },
  { n: '04', title: '리포트 발행', body: '상담사용·내담자용 리포트를 발행하고 회기 추이까지 한눈에 확인합니다.' },
];

const ProcessSection: React.FC = () => {
  return (
    <section className="bg-white px-8 py-[120px]">
      <div className="max-w-[1280px] mx-auto">
        <div className="text-center mb-16">
          <span className="mb-eyebrow">서비스 흐름</span>
          <h2 className="font-sans font-bold text-[42px] leading-[54px] tracking-[-0.0336em] text-gray-800 mt-5">
            측정부터 리포트까지, 한 번에
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className="bg-[#F5EDFC] rounded-[24px] p-7 min-h-[220px] relative"
            >
              <div className="font-bold text-[14px] text-purple-900 tracking-[0.1em]">{s.n}</div>
              <h3 className="font-sans font-bold text-[22px] leading-[30px] text-gray-800 mt-5 mb-[10px]">
                {s.title}
              </h3>
              <p className="font-medium text-[14px] leading-[22px] text-black/60 m-0">{s.body}</p>
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute -right-[14px] top-1/2 -translate-y-1/2 text-[22px] font-light text-[#B373EF]">
                  ›
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProcessSection;
