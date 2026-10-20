// 공개 계정 삭제 요청 페이지(/account-deletion) — 스토어 심사용 웹 삭제 경로. 로그인 불필요.
// 접수만으로 계정이 삭제되지는 않고, 운영팀이 본인 확인 뒤 처리한다. 계정 존재 여부와 무관하게 같은 안내를 보여 준다.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api/client';
import { submitAccountDeletionRequest } from '../lib/api/account';
import { DELETION_NOTICE_LINES } from '../lib/account-deletion-copy';

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
    <main className="mx-auto max-w-xl px-5 py-12 text-[#1F1F1F]">
      <h1 className="text-2xl font-extrabold">MIND BREEZE 계정 삭제 요청</h1>
      <p className="mt-3 text-[15px] text-[#3F3F3F]">
        앱에 로그인할 수 있다면 <strong>설정 &gt; 계정 삭제</strong>에서 바로 탈퇴할 수 있어요. 로그인할 수 없을 때는 아래에 가입한 이메일을 남겨 주세요.
      </p>
      <ul className="mt-5 list-disc space-y-2 pl-5 text-[14px] text-[#3F3F3F]">
        {DELETION_NOTICE_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {done ? (
        <p role="status" className="mt-8 rounded-xl bg-[#F3E8FF] px-4 py-4 text-[15px]">
          요청을 접수했어요. 운영팀이 본인 확인을 위해 입력하신 이메일로 연락드려요. 접수만으로 계정이 삭제되지는 않아요.
        </p>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 flex flex-col gap-3">
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
            className="h-12 rounded-xl bg-[#5F0080] text-[15px] font-semibold text-white disabled:opacity-50"
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
      <p className="mt-8 text-sm">
        <Link to="/" className="underline">
          처음으로
        </Link>
      </p>
    </main>
  );
}
