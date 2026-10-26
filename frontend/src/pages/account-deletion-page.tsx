// 공개 계정 삭제 안내·요청 페이지(/account-deletion) — 스토어 심사용 웹 삭제 경로. 로그인 불필요.
// Google Play 데이터 삭제 URL 요건: 앱·개발자 이름, 앱 안 삭제 단계, 앱 밖 요청 방법, 삭제·보관 데이터와 기간.
// 접수만으로 계정이 삭제되지는 않고, 운영팀이 본인 확인 뒤 처리한다. 계정 존재 여부와 무관하게 같은 안내를 보여 준다.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api/client';
import { submitAccountDeletionRequest } from '../lib/api/account';
import {
  DELETION_DATA_ROWS,
  DELETION_NOTICE_LINES,
  DELETION_SUPPORT_EMAIL,
  IN_APP_DELETION_STEPS,
  OUTSIDE_APP_REQUEST_LINES,
} from '../lib/account-deletion-copy';
import { DEVELOPER_NAME, SERVICE_NAME, SERVICE_SUBTITLE } from '../lib/legal-copy';
import { buttonClass } from '../components/ui';

const MAIL_SUBJECT = encodeURIComponent('MIND BREEZE 계정 삭제 요청');

export default function AccountDeletionPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitAccountDeletionRequest(email.trim());
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
      } else if (err instanceof ApiError && err.status === 422) {
        setError('이메일 주소를 올바르게 입력해 주세요.');
      } else {
        setError('요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl break-keep px-5 py-12 text-[#1F1F1F]">
      <h1 className="text-2xl font-extrabold">MIND BREEZE 계정 삭제 요청</h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px] text-[#3F3F3F]">
        <dt className="font-semibold">앱</dt>
        <dd>{SERVICE_NAME} · {SERVICE_SUBTITLE}</dd>
        <dt className="font-semibold">개발자</dt>
        <dd>{DEVELOPER_NAME}</dd>
        <dt className="font-semibold">문의</dt>
        <dd>
          <a href={`mailto:${DELETION_SUPPORT_EMAIL}?subject=${MAIL_SUBJECT}`} className="underline">
            {DELETION_SUPPORT_EMAIL}
          </a>
        </dd>
      </dl>

      <section aria-labelledby="in-app-title" className="mt-10">
        <h2 id="in-app-title" className="text-lg font-bold">앱에서 계정 삭제하기</h2>
        <p className="mt-2 text-[15px] text-[#3F3F3F]">앱에 로그인할 수 있다면 앱 안에서 바로 탈퇴할 수 있어요.</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-[14px] text-[#3F3F3F]">
          {IN_APP_DELETION_STEPS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="outside-title" className="mt-10">
        <h2 id="outside-title" className="text-lg font-bold">앱 밖에서 삭제 요청하기</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] text-[#3F3F3F]">
          {OUTSIDE_APP_REQUEST_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="notice-title" className="mt-10">
        <h2 id="notice-title" className="text-lg font-bold">탈퇴하면 이렇게 돼요</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] text-[#3F3F3F]">
          {DELETION_NOTICE_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="data-title" className="mt-10">
        <h2 id="data-title" className="text-lg font-bold">삭제·보관되는 데이터와 기간</h2>
        <dl className="mt-3 divide-y divide-[#ECE7ED] rounded-xl border border-[#ECE7ED] text-[14px]">
          {DELETION_DATA_ROWS.map((row) => (
            <div key={row.label} className="px-4 py-3">
              <dt className="font-semibold text-[#1F1F1F]">{row.label}</dt>
              <dd className="mt-1 text-[#3F3F3F]">{row.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] text-[#6F6F6F]">
          자세한 기준은{' '}
          <Link to="/privacy#account-deletion" className="underline">
            개인정보 처리방침
          </Link>
          을 확인해 주세요.
        </p>
      </section>

      <section aria-labelledby="request-title" className="mt-10">
        <h2 id="request-title" className="text-lg font-bold">삭제 요청 보내기</h2>
        <p className="mt-2 text-[14px] text-[#3F3F3F]">로그인할 수 없을 때 가입한 이메일을 남겨 주세요.</p>
        {done ? (
          <p role="status" className="mt-4 rounded-xl bg-[#F3E8FF] px-4 py-4 text-[15px]">
            요청을 접수했어요. 운영팀이 본인 확인을 위해 입력하신 이메일로 연락드려요. 접수만으로 계정이 삭제되지는 않아요.
          </p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 flex flex-col gap-3">
            <label htmlFor="deletion-email" className="text-sm font-medium">
              가입한 이메일
            </label>
            <input
              id="deletion-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="h-12 rounded-xl border border-[#DDDEE7] px-4 outline-none focus:ring-2 focus:ring-[#5F0080]"
            />
            <button
              type="submit"
              disabled={busy || !email}
              className={buttonClass({ variant: 'primary' })}
            >
              {busy ? '접수 중…' : '삭제 요청 보내기'}
            </button>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
          </form>
        )}
      </section>

      <nav aria-label="관련 안내" className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link to="/" className="underline">처음으로</Link>
        <Link to="/support" className="underline">고객 지원</Link>
        <Link to="/privacy" className="underline">개인정보 처리방침</Link>
        <Link to="/terms" className="underline">이용약관</Link>
      </nav>
    </main>
  );
}
