import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { createInvite, type InviteCreateResponse } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';
import { buttonClass, cardClass, fieldClass } from '../../components/ui';

export default function ClientInvitePage() {
  const navigate = useNavigate();
  const { isAuthenticated, isInitialized, user } = useAuthStore();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      navigate('/login?role=counselor');
    }
  }, [isInitialized, isAuthenticated, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await createInvite(email.trim());
      setInvite(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '초대 생성에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.invite_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('클립보드 복사에 실패했습니다');
    }
  };

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
        <div
          role="status"
          aria-label="불러오는 중"
          className="h-8 w-8 animate-spin rounded-full border-2 border-[#5F0080] border-t-transparent"
        />
      </div>
    );
  }

  if (user && user.role !== 'counselor') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-6">
        <p className="text-gray-600">코치 전용 페이지입니다.</p>
      </div>
    );
  }

  // 외곽 gutter는 셸 기본(16/32/40)과 같게, 폼 폭(576)은 읽기 목적이라 유지
  return (
    <div className="min-h-screen bg-surface-canvas px-4 py-4 md:px-8 md:py-6 lg:px-10 lg:pt-8 lg:pb-10">
      <div className="max-w-xl mx-auto">
        <button
          onClick={() => navigate('/clients')}
          className="inline-flex h-11 items-center px-3 -ml-3 text-sm text-[#6F6F6F] hover:text-[#5F0080] mb-2"
        >
          ← 목록으로
        </button>

        <div className={cardClass('default')}>
          <h1 className="mb-2 text-[22px] font-bold leading-[30px] text-[#1F1F1F] md:leading-[33px]">회원 초대</h1>
          <p className="text-sm text-gray-500 mb-6">
            초대할 회원의 이메일을 입력하면 초대 링크가 생성됩니다.
          </p>

          {user?.counselor_code && <section aria-label="코치 초대 코드" className="mb-6 rounded-xl bg-[#F5EDFC] p-4">
            <h2 className="text-base font-bold text-[#5F0080]">내 초대 코드</h2>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><strong className="break-all font-mono text-xl tracking-widest text-[#5F0080]">{user.counselor_code}</strong><button type="button" className={buttonClass({ variant: 'secondary', size: 'sm', className: 'bg-white' })} onClick={() => {
              if (!navigator.clipboard) { setError('초대 코드를 직접 선택해 복사해 주세요.'); return; }
              void navigator.clipboard.writeText(user.counselor_code ?? '').then(() => setCodeCopied(true)).catch(() => setError('초대 코드를 복사하지 못했어요. 직접 선택해 복사해 주세요.'));
            }}>초대 코드 복사</button></div>
            <p className="mt-2 text-sm text-[#6F6F6F]">이 코드를 회원에게 공유하면 코치와 연결할 수 있어요.</p>{codeCopied && <p role="status" className="mt-2 text-sm">초대 코드를 복사했어요.</p>}
          </section>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'invite-error' : undefined}
                placeholder="client@example.com"
                className={fieldClass('input')}
              />
            </div>

            {error && <p id="invite-error" role="alert" className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className={buttonClass({ variant: 'primary', className: 'w-full' })}
            >
              {loading ? '생성 중...' : '초대 링크 생성'}
            </button>
          </form>

          {invite && (
            <div className="mt-6 p-4 bg-[#F5EDFC] border border-[#E8D9F5] rounded-xl">
              <p className="text-sm font-medium text-[#5F0080] mb-2">초대 링크가 생성되었습니다</p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  readOnly
                  value={invite.invite_url}
                  className={fieldClass('input', 'flex-1 text-sm')}
                />
                <button
                  onClick={handleCopy}
                  className={buttonClass({ variant: 'primary', size: 'sm', className: 'shrink-0' })}
                >
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                회원에게 이 링크를 공유하면 가입 후 자동으로 연결됩니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
