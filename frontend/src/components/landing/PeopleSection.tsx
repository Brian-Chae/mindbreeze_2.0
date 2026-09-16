import { SectionHeading, sectionContainer } from './landing-ui';

const audiences = [
  { label: '상담센터 · 기관', number: '01', question: '운영은 체계적으로,\n돌봄의 질은 한결같이.', pain: '흩어진 세션 기록과 리포트, 매번 정리하기 버거우셨나요?', solution: '세션부터 기록·리포트까지 한곳에서 관리해 센터의 돌봄이 꾸준히 이어지도록 돕습니다.', tags: ['세션 관리', '기록 연결'], icon: 'M4 21V7l8-4 8 4v14M2 21h20M9 21v-6h6v6M8 9h1m6 0h1M8 12h1m6 0h1' },
  { label: '상담사', number: '02', question: '기록하는 시간보다,\n마주 보는 시간을.', pain: '상담이 끝난 뒤에도 기록을 작성하느라 하루가 길어지나요?', solution: '동의받은 음성을 AI가 기록하고 요약합니다. 내용을 검토하고, 내담자에게 더 집중하세요.', tags: ['AI 기록·요약', '전문가 검토'], icon: 'M5 3h11l3 3v15H5V3Zm4 5h6M9 12h6M9 16h4' },
  { label: '명상가 · 지도자', number: '03', question: '느꼈던 작은 변화를,\n함께 나누는 언어로.', pain: '수업에서 느낀 변화를 참여자에게 어떻게 전하면 좋을까요?', solution: '선택적으로 측정한 몸·마음의 흐름을 서사형 리포트로 전달해 수업 후의 대화를 이어갑니다.', tags: ['선택형 측정', '변화 피드백'], icon: 'M12 3v3M4.2 6.2l2.1 2.1M3 14h3M18 14h3M17.7 8.3l2.1-2.1M8 14a4 4 0 0 1 8 0c0 2-2 3-2 5h-4c0-2-2-3-2-5Zm2 8h4' },
];

export default function PeopleSection() {
  return <section className="py-20 sm:py-28">
    <div className={sectionContainer}>
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div><SectionHeading label="DESIGNED FOR YOUR CARE">돌보는 방식은 달라도,<br />집중하고 싶은 것은 같으니까.</SectionHeading></div>
        <p className="max-w-[330px] text-base leading-7 text-[#776C7D]">반복되는 일은 가볍게.<br />사람을 이해하는 시간은 더 깊게.</p>
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {audiences.map((item) => <article key={item.label} className="flex flex-col rounded-3xl border border-[#E7DFE9] bg-[#FCFAFD] p-6 sm:p-8">
          <div className="flex items-center justify-between"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EDE3F1] text-[#5F0080]"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.icon} /></svg></span><span className="text-xs tracking-widest text-[#95809E]">{item.number}</span></div>
          <p className="mt-7 text-xs font-bold text-[#5F0080]">{item.label}</p>
          <h3 className="mt-3 whitespace-pre-line text-[23px] font-bold leading-[1.5] tracking-[-0.035em]">{item.question}</h3>
          <p className="mb-5 mt-5 text-sm leading-7 text-[#817488]">{item.pain}</p>
          <p className="mt-auto border-t border-[#E8DFEC] pt-5 text-sm leading-7 text-[#4F4555]">{item.solution}</p>
          <div className="mt-6 flex flex-wrap gap-2">{item.tags.map((tag) => <span key={tag} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#75647D]">{tag}</span>)}</div>
        </article>)}
      </div>
    </div>
  </section>;
}
