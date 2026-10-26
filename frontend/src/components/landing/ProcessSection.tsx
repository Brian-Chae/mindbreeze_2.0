import { isAiEnabled, isCounselingEnabled } from '../../lib/feature-flags';
import { SectionHeading, sectionContainer } from './landing-ui';

const steps = () => [
  isCounselingEnabled()
    ? { title: '세션을 준비하고', body: '상담·명상 일정을 등록하고, 참여자와 측정 여부를 정해요.' }
    : { title: '클래스를 준비하고', body: '명상 클래스 일정을 등록하고, 참여자와 측정 여부를 정해요.' },
  { title: '사람에게 집중하면', body: '동의받은 음성을 기록하고, 원할 때 LINK BAND로 신호를 측정해요.' },
  { title: isAiEnabled() ? 'AI가 기록을 정리해요' : '기록을 함께 정리해요', body: isAiEnabled() ? '기록과 요약을 검토하고, 측정된 변화도 함께 살펴보세요.' : '기록과 리포트를 검토하고, 측정된 변화도 함께 살펴보세요.' },
  { title: '변화를 함께 나눠요', body: '리포트를 확인한 뒤 전달하고, 다음 만남의 대화를 이어가세요.' },
];
export default function ProcessSection() {
  return <section className="border-y border-[#EDE7EF] bg-[#FCFAFD] py-20 sm:py-24">
    <div className={sectionContainer}>
      <SectionHeading label="A CONNECTED EXPERIENCE">한 번의 만남이,<br className="sm:hidden" /> 다음 돌봄으로 이어지도록.</SectionHeading>
      <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{steps().map((step, index) => <li key={step.title} className="border-t border-[#D9C9E0] pt-6"><span className="text-xs font-bold tracking-widest text-[#5F0080]">0{index + 1}</span><h3 className="mb-3 mt-5 text-lg font-bold">{step.title}</h3><p className="text-sm leading-7 text-[#776A7E]">{step.body}</p></li>)}</ol>
      <p className="mt-10 text-sm leading-7 text-[#74677A]">LINK BAND 착용은 선택입니다. 기기 없이도 {isAiEnabled() ? '상담 기록·AI 요약·리포트 기능' : '클래스 기록·리포트 기능'}을 이용할 수 있어요.</p>
    </div>
  </section>;
}
