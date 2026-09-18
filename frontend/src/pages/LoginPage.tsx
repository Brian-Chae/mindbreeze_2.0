import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';
import { resolvePostLoginPath } from '../lib/auth-routing';
import DevRoleSimulationPanel from '../components/auth/DevRoleSimulationPanel';

const isRoleSimEnabled = import.meta.env.VITE_ENABLE_ROLE_SIM === 'true';
const tabs = [
  { role: 'client', label: '회원', description: '상담과 명상을 이용하는 회원을 위한 로그인입니다.', submit: '이메일로 회원 로그인' },
  { role: 'counselor', label: '상담사', description: '상담사 계정으로 세션과 회원을 관리하세요.', submit: '상담사 로그인' },
  { role: 'org_admin', label: '기관', description: '기관에서 발급받은 관리자 계정을 사용하세요.', submit: '기관 관리자 로그인' },
] as const;
type PublicRole = typeof tabs[number]['role'];
type LoginRole = PublicRole | 'platform_admin';
interface LoginIntent { role: LoginRole; next: string | null }

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const loginGoogle = useAuthStore((s) => s.loginGoogle);
  const requestedRole = searchParams.get('role');
  const loginRole: LoginRole = requestedRole === 'platform_admin' ? 'platform_admin'
    : tabs.find((tab) => tab.role === requestedRole)?.role ?? 'client';
  const isAdmin = loginRole === 'platform_admin';
  const config = tabs.find((tab) => tab.role === loginRole) ?? tabs[0];
  const next = isAdmin ? searchParams.get('next') : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'email' | 'google' | null>(null);
  // 팝업이 열린 동안 URL이 바뀌어도 인증 시작 시 선택한 역할을 사용한다.
  const intent = useRef<LoginIntent | null>(null);
  const googleExchanging = useRef(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const busy = pending !== null;
  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  useEffect(() => {
    setPassword('');
    setError(null);
  }, [loginRole]);

  const finish = () => {
    intent.current = null;
    googleExchanging.current = false;
    setPending(null);
  };
  const showError = (err: unknown) => {
    setError(err instanceof ApiError
      ? err.status === 423 ? '계정이 잠겼습니다. 15분 후 다시 시도해주세요'
        : err.message || '로그인에 실패했습니다.'
      : '네트워크 오류가 발생했습니다. 다시 시도해주세요.');
  };
  const begin = (method: 'email' | 'google'): LoginIntent | null => {
    if (intent.current) return null;
    const started = { role: loginRole, next };
    intent.current = started;
    setError(null);
    setPending(method);
    return started;
  };
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isAdmin) return;
    const started = begin('email');
    if (!started) return;
    try {
      const user = await login(email, password, started.role);
      navigate(resolvePostLoginPath(user, started.next));
    } catch (err) {
      showError(err);
    } finally {
      finish();
    }
  };
  const googleLogin = useGoogleLogin({
    onSuccess: async (response) => {
      const started = intent.current;
      if (!started || googleExchanging.current) return;
      googleExchanging.current = true;
      try {
        const user = await loginGoogle(response.access_token, undefined, started.role);
        navigate(resolvePostLoginPath(user, started.next));
      } catch (err) {
        showError(err);
      } finally {
        finish();
      }
    },
    onError: () => {
      setError('Google 로그인 중 오류가 발생했습니다. 다시 시도해주세요.');
      finish();
    },
    onNonOAuthError: () => {
      if (googleExchanging.current) return;
      setError('Google 로그인 창이 닫혔거나 열리지 않았습니다. 다시 시도해주세요.');
      finish();
    },
  });
  const handleGoogleClick = () => {
    if (loginRole === 'org_admin' || !hasGoogleClientId || !begin('google')) return;
    try { googleLogin(); } catch (err) { showError(err); finish(); }
  };
  const selectTab = (index: number) => {
    if (intent.current) return;
    setSearchParams({ role: tabs[index].role });
    tabRefs.current[index]?.focus();
  };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (target !== null) { event.preventDefault(); selectTab(target); }
  };
  const googleButton = (
    <button type="button" onClick={handleGoogleClick} disabled={busy || !hasGoogleClientId}
      className={`flex h-[52px] w-full items-center justify-center gap-3 rounded-full border border-white/30 px-4 text-[15px] font-semibold transition-colors disabled:opacity-50 ${loginRole === 'client' || loginRole === 'counselor' ? 'bg-white text-[#5F0080] hover:bg-white/90' : 'bg-white/10 text-white hover:bg-white/20'}`}>
      <img src="/mb-design/assets/icons/icon_google.svg" width={20} height={20} alt="" aria-hidden="true" />
      {pending === 'google' ? '연결 중…' : isAdmin ? 'Google Workspace로 로그인' : `Google로 ${config.label} 로그인`}
    </button>
  );
  const divider = <div className="flex items-center gap-3 text-[13px] text-white/80"><span className="h-px flex-1 bg-white/30" />또는<span className="h-px flex-1 bg-white/30" /></div>;
  const inputClass = 'h-[52px] w-full rounded-full border border-[#DDDEE7] bg-white px-5 text-[15px] text-[#1F1F1F] outline-none focus:ring-2 focus:ring-[#5F0080] disabled:opacity-50';

  return (
    <div className="relative min-h-screen font-sans">
      <img src="/mb-design/assets/images/background3.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/60" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 pb-10 pt-24 text-white">
        <Link to="/" aria-label="Mind Breeze 홈으로 이동" className="absolute left-6 top-6 flex items-center gap-2.5 text-xl font-extrabold tracking-[-0.04em] text-white">
          <img src="/mb-design/assets/logo_symbol_dark.svg" width={28} height={16} alt="" className="brightness-0 invert" />
          Mind Breeze
        </Link>
        <img src="/mb-design/assets/logo_symbol_dark.svg" width={64} height={29} alt="" className="mb-5 brightness-0 invert" />
        <h1 className="text-center text-[28px] font-extrabold tracking-tight text-white sm:text-[32px]">{isAdmin ? '플랫폼 관리자 로그인' : 'MIND BREEZE 로그인'}</h1>
        <div className="mt-6 w-full max-w-[360px]">
          {!isAdmin && <div role="tablist" aria-label="로그인 유형" className="mb-5 grid grid-cols-3 rounded-full bg-black/20 p-1">
            {tabs.map((tab, index) => <button key={tab.role} ref={(el) => { tabRefs.current[index] = el; }}
              id={`login-tab-${tab.role}`} role="tab" aria-selected={loginRole === tab.role} aria-controls={`login-panel-${tab.role}`}
              tabIndex={loginRole === tab.role ? 0 : -1} disabled={busy} onClick={() => selectTab(index)} onKeyDown={(event) => handleTabKey(event, index)}
              className={`rounded-full px-2 py-3 text-sm font-semibold disabled:opacity-60 ${loginRole === tab.role ? 'bg-white text-[#5F0080] underline decoration-2 underline-offset-4' : 'text-white hover:bg-white/10'}`}>{tab.label}</button>)}
          </div>}
          <section role={isAdmin ? undefined : 'tabpanel'} id={`login-panel-${loginRole}`} aria-labelledby={isAdmin ? undefined : `login-tab-${loginRole}`} aria-busy={busy} className="flex flex-col gap-4">
            <p className="text-center text-sm text-white/90">{isAdmin ? 'Google Workspace 계정으로 로그인하세요.' : config.description}</p>
            {!isAdmin && <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label htmlFor="login-email" className="text-sm">이메일</label>
              <input id="login-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className={inputClass} />
              <label htmlFor="login-password" className="text-sm">비밀번호</label>
              <input id="login-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className={inputClass} />
              <button type="submit" disabled={busy || !email || !password} className="mt-1 h-[52px] rounded-full bg-[#5F0080] text-[15px] font-semibold hover:bg-[#4B0066] disabled:opacity-60">{pending === 'email' ? '로그인 중…' : config.submit}</button>
            </form>}
            {loginRole === 'client' && divider}
            {(loginRole === 'client' || isAdmin) && googleButton}
            {loginRole === 'counselor' && <>{divider}{googleButton}<p className="text-center text-xs text-white/80">Google 로그인은 기존 상담사 계정만 이용할 수 있습니다.</p></>}
            {error && <p role="alert" className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-900/30">{error}</p>}
            {!isAdmin && <Link to="/forgot-password" className="text-center text-sm underline">비밀번호 찾기</Link>}
            {(loginRole === 'client' || loginRole === 'counselor') && <Link to={`/register?role=${loginRole}`} className="text-center text-sm font-semibold underline">{loginRole === 'client' ? '회원가입' : '상담사 가입'}</Link>}
            {isAdmin && <Link to="/login?role=client" className="text-center text-sm underline">일반 로그인으로 돌아가기</Link>}
          </section>
          {isRoleSimEnabled && <DevRoleSimulationPanel onLoginSuccess={(user) => navigate(resolvePostLoginPath(user, next))} />}
        </div>
      </div>
    </div>
  );
}
