import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { KeyRound } from 'lucide-react';
import { isNativeApp } from '../lib/native/platform';
import { nativeGoogleIdToken } from '../lib/native/google';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';
import { PrivacyPolicyLink } from '../components/legal/PrivacyPolicyLink';
import { resolvePostLoginPath } from '../lib/auth-routing';
import AppleLoginButton from '../components/auth/AppleLoginButton';
import { useSocialSignupStore, type SocialCredential } from '../stores/social-signup-store';

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
  // SDD-227: 이메일·비밀번호 입력 중(키보드 표시)에는 하단 코드 입장 카드를 숨긴다.
  const [typing, setTyping] = useState(false);
  // SDD-249: 소셜 신규 가입(서버 422)은 오류 문구 대신 공통 "가입 정보 확인" 화면(/signup/confirm)에서 생년월일·동의를 받는다.
  const beginSocialSignup = useSocialSignupStore((st) => st.begin);
  const goToSignupConfirm = (credential: SocialCredential, started: LoginIntent) => {
    beginSocialSignup({ credential, role: started.role, rememberMe: started.rememberMe });
    navigate('/signup/confirm');
  };
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
    // 항상 계정 선택창을 띄워 이전에 쓴 구글 계정이 자동으로 재사용되지 않게 한다.
    prompt: 'select_account',
    onSuccess: async (response) => {
      const started = intent.current;
      if (!started || googleExchanging.current) return;
      googleExchanging.current = true;
      try {
        // 기존 계정은 바로 로그인. 신규 계정은 서버가 422(생년월일·동의 필요)를 주며 이때는 계정이 만들어지지 않는다.
        const user = await loginGoogle(response.access_token, undefined, started.role, started.rememberMe, undefined, 'access_token');
        navigate(resolvePostLoginPath(user, started.next));
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          goToSignupConfirm({ provider: 'google', tokenKind: 'access_token', token: response.access_token }, started);
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
      try {
        const user = await loginGoogle(idToken, undefined, started.role, started.rememberMe, undefined, 'id_token');
        navigate(resolvePostLoginPath(user, started.next));
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          goToSignupConfirm({ provider: 'google', tokenKind: 'id_token', token: idToken }, started);
          return;
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof ApiError) {
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
    if (loginRole === 'org_admin' || (!hasGoogleClientId && !isNativeApp())) return;
    if (!begin('google')) return;
    if (isNativeApp()) { void nativeGoogleLogin(); return; }
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
  const appleButton = (
    <AppleLoginButton role={loginRole} rememberMe={rememberMe} disabled={busy}
      onSuccess={(user) => user && navigate(resolvePostLoginPath(user, next))}
      onNeedsSignupInfo={(_code, credential) => credential && goToSignupConfirm(credential, { role: loginRole, next, rememberMe })}
      onError={setError} />
  );
  const dividerWith = (label: string) => <div className="flex items-center gap-3 text-[13px] text-white/80"><span className="h-px flex-1 bg-white/30" />{label}<span className="h-px flex-1 bg-white/30" /></div>;
  const divider = dividerWith('또는');
  const isClient = !isAdmin && loginRole === 'client';
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
      <input id="login-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} disabled={busy} className={inputClass} />
      <label htmlFor="login-password" className="text-sm">비밀번호</label>
      <input id="login-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} disabled={busy} className={inputClass} />
      {rememberMeField}
      <button type="submit" disabled={busy || !email || !password} className="mt-1 h-[52px] rounded-full bg-[#5F0080] text-[15px] font-semibold hover:bg-[#4B0066] disabled:opacity-60">{pending === 'email' ? '로그인 중…' : config.submit}</button>
      <p className="text-center text-[12.5px] text-white/78 text-white/[0.78]">{config.description}</p>
    </form>
  );

  return (
    <div className="relative min-h-screen font-sans">
      <img src="/mb-design/assets/images/background3.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/60" />
      <div className="relative z-10 min-h-screen text-white">
        <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[rgba(20,0,30,0.55)] pt-[env(safe-area-inset-top)] backdrop-blur-[18px]">
          <div className="grid h-[52px] grid-cols-[44px_1fr_44px] items-center px-3">
            <Link to="/" aria-label="Mind Breeze 홈으로 이동" className="flex h-11 w-11 items-center justify-center">
              <img src="/mb-design/assets/logo_symbol_dark.svg" width={24} height={16} alt="" className="brightness-0 invert" />
            </Link>
            <h1 className="text-center text-[17px] font-bold tracking-[-0.02em] text-white">{isAdmin ? '플랫폼 관리자 로그인' : '로그인'}</h1>
          </div>
          {!isAdmin && <div className="mx-auto w-full max-w-[400px] px-5 pb-3.5 pt-1">
            <div role="tablist" aria-label="로그인 유형" className="grid grid-cols-3 rounded-full bg-black/25 p-1">
              {tabs.map((tab, index) => <button key={tab.role} ref={(el) => { tabRefs.current[index] = el; }}
                id={`login-tab-${tab.role}`} role="tab" aria-selected={loginRole === tab.role} aria-controls={`login-panel-${tab.role}`}
                tabIndex={loginRole === tab.role ? 0 : -1} disabled={busy} onClick={() => selectTab(index)} onKeyDown={(event) => handleTabKey(event, index)}
                className={`rounded-full px-1 py-2.5 text-[14px] leading-5 font-semibold disabled:opacity-60 ${loginRole === tab.role ? 'bg-white text-[#5F0080] underline decoration-2 underline-offset-4' : 'text-white hover:bg-white/10'}`}>{tab.label}</button>)}
            </div>
          </div>}
        </header>
        <div className="mx-auto w-full max-w-[408px] px-6 pb-10 pt-[26px]">
          <section role={isAdmin ? undefined : 'tabpanel'} id={`login-panel-${loginRole}`} aria-labelledby={isAdmin ? undefined : `login-tab-${loginRole}`} aria-busy={busy} className={`flex flex-col gap-4 ${isClient ? 'pb-[calc(8.5rem+env(safe-area-inset-bottom))]' : ''}`}>
            {/* SDD-227: 회원 탭은 이메일 로그인을 위에, 간편 로그인(Google·Apple)을 아래에 둔다. */}
            {isClient && <>{emailForm}
              <p className="text-center text-sm text-white"><Link to="/forgot-password" className="text-white underline">비밀번호 찾기</Link><span aria-hidden="true" className="mx-2 text-white/60">·</span><Link to="/register?role=client" className="font-semibold text-white underline">회원가입</Link></p>
              {dividerWith('간편 로그인')}{googleButton}{appleButton}</>}
            {!isAdmin && loginRole === 'counselor' && <>{emailForm}{divider}{googleButton}{appleButton}<p className="text-center text-xs text-white/80">Google·Apple 로그인은 기존 상담사 계정만 이용할 수 있습니다.</p></>}
            {!isAdmin && loginRole === 'org_admin' && emailForm}
            {isAdmin && <>{rememberMeField}{googleButton}<p className="text-center text-[12.5px] text-white/78 text-white/[0.78]">Google Workspace 계정으로 로그인하세요.</p></>}
            {error && <p role="alert" className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-900/30">{error}</p>}
            {!isAdmin && !isClient && <Link to="/forgot-password" className="text-center text-sm underline">비밀번호 찾기</Link>}
            {loginRole === 'counselor' && <Link to="/register?role=counselor" className="text-center text-sm font-semibold underline">상담사 가입</Link>}
            {isAdmin && <Link to="/login?role=client" className="text-center text-sm underline">일반 로그인으로 돌아가기</Link>}
            <p className="text-center text-xs text-white/80"><PrivacyPolicyLink>개인정보 처리방침</PrivacyPolicyLink></p>
          </section>
          {DevRoleSimulationPanel && isRoleSimEnabled && (
            <Suspense fallback={null}>
              <DevRoleSimulationPanel onLoginSuccess={(user) => navigate(resolvePostLoginPath(user, next))} />
            </Suspense>
          )}
        </div>
      </div>
      {/* SDD-227: 회원 탭 전용 — 로그인 없이 코드로 클래스 입장(앱은 랜딩이 없어 유일한 진입점). 코드는 URL에 싣지 않는다. */}
      {isClient && !typing && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#14001E]/85 from-60% to-transparent px-4 pt-7 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Link to="/join" data-testid="login-code-entry"
            className="mx-auto flex w-full max-w-[400px] items-center gap-3 rounded-[20px] bg-white/95 p-4 text-[#1F1F1F] shadow-[0_10px_28px_rgba(0,0,0,0.35)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-[#F3E9F8]">
              <KeyRound size={22} color="#5F0080" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-extrabold">입장 코드가 있나요?</span>
              <span className="mt-0.5 block text-xs text-[#666]">로그인 없이 바로 들어가요</span>
            </span>
            <span className="ml-auto flex h-9 shrink-0 items-center whitespace-nowrap rounded-full bg-[#5F0080] px-3.5 text-[13px] font-bold text-white">코드로 입장</span>
          </Link>
        </div>
      )}
    </div>
  );
}
