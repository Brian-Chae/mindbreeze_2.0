import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { Arrow, primaryButton, SectionHeading, sectionContainer } from './landing-ui';

const ReportSampleModal = lazy(() => import('../../pages/reports/ReportSamplePage').then((module) => ({ default: module.ReportSampleModal })));

class PreviewLoadBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="fixed inset-x-6 bottom-6 z-50 mx-auto max-w-md rounded-2xl border border-[#E4D6E9] bg-white p-5 text-sm text-[#5F0080] shadow-xl"><p>리포트를 불러오지 못했어요. 연결을 확인하고 페이지를 새로고침해 주세요.</p><button type="button" onClick={this.props.onClose} className="mt-3 min-h-11 rounded-lg border px-4 py-2">닫기</button></div>;
    return this.props.children;
  }
}

export default function ReportPreviewSection() {
  const [open, setOpen] = useState(false);
  return <section className="bg-white py-20 sm:py-28">
    <div className={`${sectionContainer} grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-20`}>
      <div>
        <SectionHeading label="YOUR CHANGE, YOUR STORY">몇 점인지보다,<br />어떻게 달라졌는지.</SectionHeading>
        <p className="mt-6 text-base leading-8 text-[#766A7D]">몸과 마음의 작은 변화를 읽기 쉬운 이야기로.<br />전반과 후반의 흐름을 비교하고, 오늘의 경험을 자신의 느낌과 함께 돌아봅니다.</p>
        <ul className="mt-7 space-y-4 text-sm text-[#55465F]">
          {['호흡·심박의 흐름으로 살펴보는 몸의 변화', '집중·이완의 흐름으로 돌아보는 마음의 변화', '다음 만남까지 이어지는 자기 이해의 기록'].map((text) => <li key={text} className="flex gap-3"><span aria-hidden="true" className="text-[#5F0080]">✓</span>{text}</li>)}
        </ul>
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={`${primaryButton} mt-9`}>샘플 리포트 열어보기 <Arrow diagonal /></button>
        <p className="mt-4 text-xs leading-6 text-[#83748C]">로그인 없이 확인할 수 있어요 · 예시 데이터</p>
      </div>
      <div className="relative rounded-[28px] bg-[#F1EAF5] p-4 sm:p-8">
        <article className="rounded-2xl border border-[#E6DCEB] bg-[#FFFEFC] p-6 shadow-xl shadow-[#54345E]/5 sm:p-9" aria-label="서사형 리포트 소개 예시">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECE5F0] pb-5"><span className="text-sm font-bold tracking-tight text-[#5F0080]">mind breeze <span className="ml-1 text-[10px] font-normal text-[#96849E]">몸·마음 리포트</span></span><span className="rounded-full bg-[#F2EDF5] px-2.5 py-1 text-[10px] font-semibold text-[#7D5B8C]">예시 미리보기</span></div>
          <p className="mt-7 text-[10px] font-bold tracking-[0.18em] text-[#8D7299]">나에게 돌아온 20분</p>
          <h3 className="mt-3 text-2xl font-bold leading-relaxed tracking-[-0.04em]">서서히 느려진 호흡,<br />조금 더 머무른 마음.</h3>
          <p className="mt-4 text-sm leading-7 text-[#87748E]">오늘의 작은 변화를,<br />몸의 리듬과 마음의 흐름에서 만나보세요.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-[#EEF4F0] p-4"><p className="text-[10px] font-bold tracking-widest text-[#547765]">BODY</p><p className="mt-2 text-sm font-semibold text-[#3E5B4C]">몸이 들려주는 리듬</p><p className="mt-2 text-xs leading-6 text-[#6B7E71]">호흡 · 심박 · 박동 간격</p></div>
            <div className="rounded-xl bg-[#F3EEF6] p-4"><p className="text-[10px] font-bold tracking-widest text-[#896198]">MIND</p><p className="mt-2 text-sm font-semibold text-[#71527F]">지금 이 순간의 마음</p><p className="mt-2 text-xs leading-6 text-[#8A7693]">집중 · 이완 · 감정안정</p></div>
          </div>
          <p className="mt-6 border-t border-[#ECE5F0] pt-4 text-[11px] leading-6 text-[#95869C]">나를 평가하는 점수 대신,<br />나를 이해하는 이야기를 남깁니다.</p>
        </article>
        <p className="mt-4 text-center text-[11px] leading-5 text-[#8A7593]">디자인 소개용 예시 · 의학적 진단이나 치료를 대신하지 않습니다.</p>
      </div>
    </div>
    {open && <PreviewLoadBoundary onClose={() => setOpen(false)}><Suspense fallback={<div role="status" className="fixed inset-x-6 bottom-6 z-50 mx-auto flex max-w-md items-center justify-between gap-4 rounded-2xl border border-[#E4D6E9] bg-white p-5 text-sm text-[#5F0080] shadow-xl">리포트를 불러오는 중이에요.<button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2">취소</button></div>}><ReportSampleModal onClose={() => setOpen(false)} /></Suspense></PreviewLoadBoundary>}
  </section>;
}
