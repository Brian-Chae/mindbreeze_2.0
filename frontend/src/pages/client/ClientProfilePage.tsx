// 내담자 프로필 페이지
// 내 정보, 연결된 상담사, 상담사 코드 입력, 리포트 링크, 알림 설정, 로그아웃

import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { apiClient } from '../../lib/api/client';

/** 빈 상태 컴포넌트 */
function EmptyState({
  icon,
  title,
  description,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="text-[#9B9B9B] mb-3">{icon}</div>
      <p className="text-sm font-medium text-[#1F1F1F] mb-1">{title}</p>
      {description && <p className="text-xs text-[#6F6F6F] mb-4">{description}</p>}
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  );
}

/** 상담사 코드 입력 섹션 */
function CounselorCodeInput({
  onSuccess,
}: {
  onSuccess: (counselors: Array<{ id: string; name: string; profile_image: string | null }>) => void;
}) {
  const [code, setCode] = useState<string[]>(Array(6).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = useCallback(
    (index: number, value: string) => {
      if (value && !/^\d$/.test(value)) return;
      setError(null);
      const newCode = [...code];
      newCode[index] = value;
      setCode(newCode);
      if (value && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [code]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !code[index] && index > 0) {
        const newCode = [...code];
        newCode[index - 1] = '';
        setCode(newCode);
        inputRefs.current[index - 1]?.focus();
      }
    },
    [code]
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newCode = Array(6).fill('');
    for (let i = 0; i < pasted.length; i++) {
      newCode[i] = pasted[i];
    }
    setCode(newCode);
    setError(null);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  }, []);

  // 6자리 모두 입력 시 자동 제출
  useEffect(() => {
    const fullCode = code.join('');
    if (fullCode.length !== 6) return;

    let cancelled = false;
    async function submit() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.post<{
          counselors: Array<{ id: string; name: string; profile_image: string | null }>;
        }>('/client/counselors', { code: fullCode });

        if (cancelled) return;
        onSuccess(res.counselors);
      } catch (err: unknown) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : '유효하지 않은 상담사 코드입니다';
        setError(message);
        setCode(Array(6).fill(''));
        inputRefs.current[0]?.focus();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    submit();
    return () => {
      cancelled = true;
    };
  }, [code, onSuccess]);

  return (
    <div className="bg-[#F5EDFC] rounded-2xl p-4">
      <p className="text-sm font-medium text-[#1F1F1F] mb-3">
        상담사 코드 입력 (6자리 숫자)
      </p>
      <div className="flex gap-2 justify-center mb-3">
        {code.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            autoFocus={i === 0}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            disabled={loading}
            className={`w-10 h-12 text-center text-lg font-bold rounded-lg border-2 outline-none transition-colors ${
              error
                ? 'border-red-400 bg-red-50'
                : digit
                  ? 'border-[#5F0080] bg-white'
                  : 'border-[#D4D4D4] bg-white focus:border-[#5F0080]'
            } text-[#1F1F1F] disabled:opacity-50`}
          />
        ))}
      </div>
      {error && <p className="text-red-500 text-xs text-center mb-2">{error}</p>}
      {loading && <p className="text-[#6F6F6F] text-xs text-center">연결 중...</p>}
      <p className="text-[11px] text-[#6F6F6F] text-center">
        상담사에게 받은 6자리 코드를 입력하세요
      </p>
    </div>
  );
}

export default function ClientProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const [showCodeInput, setShowCodeInput] = useState(false);
  const [emailNotif, setEmailNotif] = useState(() => {
    try {
      return localStorage.getItem('mb_email_notif') !== 'false';
    } catch {
      return true;
    }
  });

  const toggleEmailNotif = () => {
    const next = !emailNotif;
    setEmailNotif(next);
    try {
      localStorage.setItem('mb_email_notif', String(next));
    } catch {
      // ignore
    }
  };

  const handleCounselorSuccess = (
    counselors: Array<{ id: string; name: string; profile_image: string | null }>
  ) => {
    if (!user) return;
    const existing = user.counselors ?? [];
    // 중복 제거 후 합치기
    const existingIds = new Set(existing.map((c) => c.id));
    const newCounselors = counselors.filter((c) => !existingIds.has(c.id));
    setUser({
      ...user,
      counselors: [...existing, ...newCounselors],
    });
    setShowCodeInput(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const counselors = user?.counselors ?? [];

  return (
    <div className="pb-6">
      {/* 내 정보 카드 */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mx-4 mt-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[#F3E5F5] flex items-center justify-center text-[#5F0080] text-xl font-bold">
            {user?.name?.charAt(0) ?? '?'}
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1F1F1F]">{user?.name ?? '이름 없음'}</h2>
            <p className="text-sm text-[#6F6F6F]">{user?.email ?? ''}</p>
          </div>
        </div>
      </div>

      {/* 연결된 상담사 */}
      <div className="mx-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#1F1F1F]">연결된 상담사</h3>
          <button
            type="button"
            onClick={() => setShowCodeInput(!showCodeInput)}
            className="flex items-center gap-1 text-sm font-medium text-[#5F0080] hover:underline"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            상담사 코드 입력
          </button>
        </div>

        {/* 코드 입력 영역 */}
        {showCodeInput && (
          <div className="mb-3">
            <CounselorCodeInput onSuccess={handleCounselorSuccess} />
          </div>
        )}

        {counselors.length === 0 ? (
          <EmptyState
            icon={
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
            title="아직 연결된 상담사가 없어요"
            description="상담사에게 받은 코드를 입력하여 연결을 시작하세요"
            cta={
              <button
                type="button"
                onClick={() => setShowCodeInput(true)}
                className="px-4 py-2 bg-[#5F0080] text-white text-sm font-medium rounded-xl hover:bg-[#4A0066] transition-colors"
              >
                + 상담사 코드 입력
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            {counselors.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3"
              >
                {c.profile_image ? (
                  <img
                    src={c.profile_image}
                    alt={c.name}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#F3E5F5] flex items-center justify-center text-[#5F0080] text-sm font-bold">
                    {c.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1F1F1F] truncate">{c.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[#F3E5F5] text-[#5F0080] text-[10px] font-bold">
                      상담사
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 내 리포트 보기 */}
      <div className="mx-4 mt-4">
        <button
          type="button"
          onClick={() => navigate('/app/reports')}
          className="w-full bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#E0F2FE] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#075985" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-[#1F1F1F]">내 리포트 보기</span>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6F6F6F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* 알림 설정 */}
      <div className="mx-4 mt-4">
        <h3 className="text-sm font-semibold text-[#1F1F1F] mb-2">알림 설정</h3>
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-[#EFEFEF]">
          <div className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium text-[#1F1F1F]">이메일 알림</p>
              <p className="text-xs text-[#6F6F6F]">리포트 및 세션 알림을 이메일로 받기</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={emailNotif}
              onClick={toggleEmailNotif}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                emailNotif ? 'bg-[#5F0080]' : 'bg-[#D4D4D4]'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  emailNotif ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 로그아웃 */}
      <div className="mx-4 mt-6 mb-4">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full py-3 text-center text-sm font-medium text-red-500 bg-white rounded-2xl shadow-sm hover:bg-red-50 transition-colors"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
