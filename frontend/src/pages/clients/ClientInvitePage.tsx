import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { createInvite, type InviteCreateResponse } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';

export default function ClientInvitePage() {
  const navigate = useNavigate();
  const { isAuthenticated, isInitialized, user } = useAuthStore();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      navigate('/login');
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

  if (!isInitialized) return null;

  if (user && user.role !== 'counselor') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-6">
        <p className="text-gray-600">상담사 전용 페이지입니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-canvas p-6">
      <div className="max-w-xl mx-auto">
        <button
          onClick={() => navigate('/clients')}
          className="text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          ← 목록으로
        </button>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h1 className="text-2xl font-semibold mb-2">내담자 초대</h1>
          <p className="text-sm text-gray-500 mb-6">
            초대할 내담자의 이메일을 입력하면 초대 링크가 생성됩니다.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? '생성 중...' : '초대 링크 생성'}
            </button>
          </form>

          {invite && (
            <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-md">
              <p className="text-sm font-medium text-emerald-900 mb-2">초대 링크가 생성되었습니다</p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  readOnly
                  value={invite.invite_url}
                  className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md text-sm"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 bg-gray-800 text-white text-sm rounded-md hover:bg-gray-900"
                >
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                내담자에게 이 링크를 공유하면 가입 후 자동으로 연결됩니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
