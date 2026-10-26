import { supportQuestions } from '../../lib/support-faq';
import { Link } from 'react-router-dom';
import { Arrow, SectionHeading, sectionContainer } from './landing-ui';


export function CTASection() {
  return <>
    <section className="py-20 sm:py-28"><div className={`${sectionContainer} grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20`}>
      <div><SectionHeading label="HERE TO HELP">궁금한 점이<br />있으신가요?</SectionHeading><p className="mt-5 text-sm leading-7 text-[#7D6D86]">시작하기 전, 자주 묻는 질문을 모았어요.<br />기관 도입에 대해 더 이야기하고 싶다면</p><a href="mailto:admin-mindbreeze@looxidlabs.com?subject=Mind%20Breeze%20도입%20문의" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#5F0080] underline decoration-[#D3BDD9] underline-offset-4">이메일로 도입 문의 <Arrow diagonal /></a></div>
      <div className="border-t border-[#E4DDE8]">{supportQuestions().map((item) => <details key={item.question} className="group border-b border-[#E4DDE8] py-1"><summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-5 py-5 text-[15px] font-semibold text-[#44324E] [&::-webkit-details-marker]:hidden">{item.question}<span aria-hidden="true" className="text-xl font-normal text-[#896495] group-open:rotate-45">+</span></summary><p className="pb-6 pr-8 text-sm leading-7 text-[#796985]">{item.answer}</p></details>)}</div>
    </div></section>
    <section className="px-6 pb-20 sm:px-10 sm:pb-24"><div className="relative mx-auto max-w-[1160px] overflow-hidden rounded-[32px] bg-[#5F0080] px-7 py-14 text-white sm:px-14 sm:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute -right-28 -top-36 h-[480px] w-[480px] rounded-full border-[70px] border-white/5" />
      <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end"><div><p className="text-xs font-medium tracking-widest text-[#DCC8E4]">BETTER CARE, TOGETHER</p><h2 className="mt-5 text-3xl font-bold text-white leading-[1.45] tracking-[-0.04em] sm:text-[40px]">마음을 돌보는 당신에게,<br />든든한 여유를.</h2><p className="mt-4 text-sm leading-7 text-[#DDCCE6]">첫 기록부터 다음 만남까지, 마인드브리즈와 함께하세요.</p></div><Link to="/register" className="inline-flex min-h-14 shrink-0 items-center justify-center gap-6 rounded-full bg-white px-7 py-4 text-sm font-bold text-[#5F0080] transition-colors hover:bg-[#F0E6F4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">회원가입하고 시작하기 <Arrow /></Link></div>
    </div></section>
  </>;
}

export function Footer() {
  return <footer className="border-t border-[#EAE3ED] bg-[#FAF8FB] py-10"><div className={`${sectionContainer} flex flex-col justify-between gap-8 sm:flex-row sm:items-start`}>
    <div><Link to="/" className="text-xl font-extrabold tracking-[-0.04em] text-[#5F0080]">Mind Breeze</Link><p className="mt-3 text-xs leading-6 text-[#8D7C94]">기술이 돕고, 사람이 돌봅니다.<br />© {new Date().getFullYear()} Looxid Labs Inc.</p></div>
    <div className="flex flex-col gap-3 text-sm text-[#77617F]"><Link to="/terms">이용약관</Link><Link to="/privacy">개인정보 처리방침</Link><Link to="/support">고객 지원</Link><Link to="/account-deletion">계정 삭제 안내</Link><Link to="/crisis-help">긴급 도움 안내</Link><Link to="/measurement-guide">측정 방법</Link><a href="mailto:admin-mindbreeze@looxidlabs.com" className="inline-flex min-h-8 items-center hover:text-[#5F0080]">admin-mindbreeze@looxidlabs.com</a><a href="https://linkband.looxidlabs.com/ko" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-2 hover:text-[#5F0080]">LINK BAND 공식 사이트 <span className="sr-only">(새 창)</span><Arrow diagonal /></a></div>
  </div></footer>;
}

export default CTASection;
