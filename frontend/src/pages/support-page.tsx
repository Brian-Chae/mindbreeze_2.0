// 공개 고객 지원 페이지(/support) — 스토어 지원 URL용. 로그인 불필요.
// 앱·개발자·문의처와 자주 묻는 질문(랜딩과 같은 데이터), 계정 삭제·정책 링크를 보여 준다.

import { Link } from 'react-router-dom';
import { DEVELOPER_NAME, OPERATIONS_EMAIL, SERVICE_NAME, SERVICE_SUBTITLE, WELLNESS_DISCLAIMER } from '../lib/legal-copy';
import { supportQuestions } from '../lib/support-faq';

const MAIL_SUBJECT = encodeURIComponent('MIND BREEZE 문의');

export function SupportPage() {
  return (
    <main className="mx-auto max-w-2xl break-keep px-5 py-12 text-[#1F1F1F]">
      <h1 className="text-2xl font-extrabold">MIND BREEZE 고객 지원</h1>
      <p className="mt-2 text-[15px] text-[#3F3F3F]">{SERVICE_SUBTITLE}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px] text-[#3F3F3F]">
        <dt className="font-semibold">앱</dt>
        <dd>{SERVICE_NAME}</dd>
        <dt className="font-semibold">개발자</dt>
        <dd>{DEVELOPER_NAME}</dd>
        <dt className="font-semibold">문의</dt>
        <dd>
          <a href={`mailto:${OPERATIONS_EMAIL}?subject=${MAIL_SUBJECT}`} className="underline">
            {OPERATIONS_EMAIL}
          </a>
        </dd>
      </dl>
      <p className="mt-3 text-[14px] text-[#3F3F3F]">
        이용 중 불편한 점, 클래스 참여 방법, 계정·개인정보 문의는 위 이메일로 보내 주세요. 클래스 일정과 참여 권한은 참여 기관 또는 진행자의 안내를 함께 확인해 주세요.
      </p>

      <section aria-labelledby="faq-title" className="mt-10">
        <h2 id="faq-title" className="text-lg font-bold">자주 묻는 질문</h2>
        <div className="mt-3 border-t border-[#ECE7ED]">
          {supportQuestions().map((item) => (
            <details key={item.question} className="border-b border-[#ECE7ED] py-1">
              <summary className="cursor-pointer py-4 text-[15px] font-semibold">{item.question}</summary>
              <p className="pb-4 text-[14px] leading-7 text-[#3F3F3F]">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="mt-8 text-[13px] text-[#6F6F6F]">{WELLNESS_DISCLAIMER}</p>

      <nav aria-label="관련 안내" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link to="/" className="underline">처음으로</Link>
        <Link to="/account-deletion" className="underline">계정 삭제 안내</Link>
        <Link to="/privacy" className="underline">개인정보 처리방침</Link>
        <Link to="/terms" className="underline">이용약관</Link>
        <Link to="/crisis-help" className="underline">긴급 도움 안내</Link>
      </nav>
    </main>
  );
}

export default SupportPage;
