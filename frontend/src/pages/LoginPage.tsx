import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { isNativeApp } from '../lib/native/platform';
import { nativeGoogleIdToken } from '../lib/native/google';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';
import { resolvePostLoginPath } from '../lib/auth-routing';

// SEC-05: 역할 시뮬레이션 패널은 DEV 빌드에서만 조건부 동적 import 한다.
// 프로덕션에서는 import.meta.env.DEV===false 로 분기가 제거되어 번들에 포함되지 않는다.
const DevRoleSimulationPanel = import.meta.env.DEV
  ? lazy(() => import('../components/auth/DevRoleSimulationPanel'))
  : null;

const isRoleSimEnabled = import.meta.env.VITE_ENABLE_ROLE_SIM === 'true';
const tabs = [
  { role: 'client', label: '회원', description: '상담과 명상을 이용하는 회원을 위한 로그인입니다.', submit: '이메일로 회원 로그인' },
  { role: 'counselor', label: '상담사', description: '상담사 계정으로 세션과 회원을 관리하세요.', submit: '상담사 로그인' },
  { role: 'org_admin', label: '기관', description: '기관에서 발급받은 관리자 계정을 사용하세요.', submit: '기관 관리자 로그인' },
] as const;
type PublicRole = typeof tabs[number]['role'];
type LoginRole = PublicRole | 'platform_admin';
interface LoginIntent { role: LoginRole; next: string | null; rememberMe: boolean }

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
  // 「로그인 상태 유지」 — 기본 체크. 해제 시 백엔드가 세션 쿠키로 발급한다.
  const [rememberMe, setRememberMe] = useState(true);
  // SEC-04 / FUNC-10: Google 동의 — 백엔드는 '신규 가입'에만 동의를 요구한다.
  // 기존 사용자는 체크 없이 통과하므로, 신규 가입 422를 받은 뒤에만 체크박스를 노출한다.
  const [googleConsent, setGoogleConsent] = useState(false);
  const [needsGoogleConsent, setNeedsGoogleConsent] = useState(false);
  // 팝업이 열린 동안 URL이 바뀌어도 인증 시작 시 선택한 역할을 사용한다.
  const intent = useRef<LoginIntent | null>(null);
  const googleExchanging = useRef(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const busy = pending !== null;
  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  useEffect(() => {
    setPassword('');
    setError(null);
    setNeedsGoogleConsent(false);
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
    const started = { role: loginRole, next, rememberMe };
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
      const user = await login(email, password, started.role, started.rememberMe);
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
        // SEC-04: 동의 체크 상태를 서버에 전달해 신규 가입 시 명시적 동의로 기록한다.
        const user = await loginGoogle(
          response.access_token,
          undefined,
          started.role,
          started.rememberMe,
          { tos: googleConsent, privacy: googleConsent, sensitive: googleConsent },
        );
        navigate(resolvePostLoginPath(user, started.next));
      } catch (err) {
        // FUNC-10: 백엔드 google_auth 는 '신규 가입'에만 동의 미비 422를 반환한다.
        // 기존 사용자는 동의 없이 통과하므로, 422일 때만 동의 체크박스를 노출해 재시도한다.
        if (err instanceof ApiError && err.status === 422) {
          setNeedsGoogleConsent(true);
          setError(
            err.message ||
              'Google로 처음 가입하는 경우 이용약관·개인정보 처리방침·민감정보 처리에 동의가 필요합니다.',
          );
        } else {
          showError(err);
        }
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
  // 네이티브 앱: 시스템 계정 선택기로 id_token 획득 → 서버 교환
  const nativeGoogleLogin = async () => {
    const started = intent.current;
    if (!started) return;
    try {
      const idToken = await nativeGoogleIdToken();
      const user = await loginGoogle(
        idToken, undefined, started.role, started.rememberMe,
        { tos: googleConsent, privacy: googleConsent, sensitive: googleConsent }, 'id_token',
      );
      navigate(resolvePostLoginPath(user, started.next));
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setNeedsGoogleConsent(true);
        setError(err.message || 'Google로 처음 가입하는 경우 이용약관·개인정보 처리방침·민감정보 처리에 동의가 필요합니다.');
      } else if (err instanceof ApiError) {
        showError(err);
      } else {
        const detail = err instanceof Error ? err.message : typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err);
        setError(`Google 로그인이 취소되었거나 실패했습니다. 다시 시도해주세요.${detail ? ` (${detail.slice(0, 120)})` : ''}`);
      }
    } finally {
      finish();
    }
  };
  const handleGoogleClick = () => {
    if (loginRole === 'org_admin' || (!hasGoogleClientId && !isNativeApp()) || !begin('google')) return;
    if (isNativeApp()) { void nativeGoogleLogin(); return; }
    // FUNC-10: 동의 여부와 무관하게 먼저 로그인을 시도한다. 기존 사용자는 그대로 통과하고,
    // 신규 가입은 백엔드가 422(동의 필요)를 주면 그때 체크박스를 노출한다.
    try { googleLogin(); } catch (err) { showError(err); finish(); }
  };
  const selectTab = (index: number) => {
    if (intent.current) return;
    // next·초대 등 기존 쿼리 파라미터를 유지한 채 role 만 갱신한다.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('role', tabs[index].role);
      return next;
    });
    tabRefs.current[index]?.focus();
  };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (target !== null) { event.preventDefault(); selectTab(target); }
  };
  const googleButton = (
    <button type="button" onClick={handleGoogleClick} disabled={busy || (!hasGoogleClientId && !isNativeApp())}
      className={`flex h-[52px] w-full items-center justify-center gap-3 rounded-full border border-white/30 px-4 text-[15px] font-semibold transition-colors disabled:opacity-50 ${loginRole === 'client' || loginRole === 'counselor' ? 'bg-white text-[#5F0080] hover:bg-white/90' : 'bg-white/10 text-white hover:bg-white/20'}`}>
      <img src="/mb-design/assets/icons/icon_google.svg" width={20} height={20} alt="" aria-hidden="true" />
      {pending === 'google' ? '연결 중…' : isAdmin ? 'Google Workspace로 로그인' : `Google로 ${config.label} 로그인`}
    </button>
  );
  // SEC-04 / FUNC-10: Google 동의 체크박스 — 신규 가입 422를 받은 뒤에만 노출한다.
  // 기존 사용자는 동의 없이 로그인되므로 처음부터 강제하지 않는다.
  const googleConsentField = (
    <label htmlFor="google-consent" className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-white/80">
      <input id="google-consent" type="checkbox" checked={googleConsent} disabled={busy}
        onChange={(event) => setGoogleConsent(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-white/50 accent-[#5F0080] disabled:cursor-not-allowed disabled:opacity-50" />
      <span>Google로 가입·로그인하면 <span className="underline">이용약관</span>, <span className="underline">개인정보 처리방침</span>, <span className="underline">민감정보 처리</span>에 동의합니다.</span>
    </label>
  );
  const divider = <div className="flex items-center gap-3 text-[13px] text-white/80"><span className="h-px flex-1 bg-white/30" />또는<span className="h-px flex-1 bg-white/30" /></div>;
  const inputClass = 'h-[52px] w-full rounded-full border border-[#DDDEE7] bg-white px-5 text-[15px] text-[#1F1F1F] outline-none focus:ring-2 focus:ring-[#5F0080] disabled:opacity-50';
  const rememberMeField = (
    <div className="flex flex-col gap-1">
      <label htmlFor="login-remember" className="flex cursor-pointer items-center gap-2 text-sm text-white/90">
        <input id="login-remember" type="checkbox" checked={rememberMe} disabled={busy}
          onChange={(event) => setRememberMe(event.target.checked)} aria-describedby="login-remember-hint"
          className="h-4 w-4 shrink-0 cursor-pointer rounded border border-white/50 accent-[#5F0080] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-50" />
        로그인 상태 유지
      </label>
      <p id="login-remember-hint" className="pl-6 text-xs text-white/70">해제하면 브라우저를 닫을 때 로그아웃됩니다.</p>
    </div>
  );

  const emailForm = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="login-email" className="text-sm">이메일</label>
      <input id="login-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className={inputClass} />
      <label htmlFor="login-password" className="text-sm">비밀번호</label>
      <input id="login-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} className={inputClass} />
      {rememberMeField}
      <button type="submit" disabled={busy || !email || !password} className="mt-1 h-[52px] rounded-full bg-[#5F0080] text-[15px] font-semibold hover:bg-[#4B0066] disabled:opacity-60">{pending === 'email' ? '로그인 중…' : config.submit}</button>
    </form>
  );

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
            {!isAdmin && loginRole === 'client' && <>{googleButton}{needsGoogleConsent && googleConsentField}{divider}{emailForm}</>}
            {!isAdmin && loginRole === 'counselor' && <>{emailForm}{divider}{googleButton}<p className="text-center text-xs text-white/80">Google 로그인은 기존 상담사 계정만 이용할 수 있습니다.</p></>}
            {!isAdmin && loginRole === 'org_admin' && emailForm}
            {isAdmin && <>{rememberMeField}{googleButton}</>}
            {error && <p role="alert" className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-900/30">{error}</p>}
            {!isAdmin && <Link to="/forgot-password" className="text-center text-sm underline">비밀번호 찾기</Link>}
            {(loginRole === 'client' || loginRole === 'counselor') && <Link to={`/register?role=${loginRole}`} className="text-center text-sm font-semibold underline">{loginRole === 'client' ? '회원가입' : '상담사 가입'}</Link>}
            {isAdmin && <Link to="/login?role=client" className="text-center text-sm underline">일반 로그인으로 돌아가기</Link>}
          </section>
          {DevRoleSimulationPanel && isRoleSimEnabled && (
            <Suspense fallback={null}>
              <DevRoleSimulationPanel onLoginSuccess={(user) => navigate(resolvePostLoginPath(user, next))} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
