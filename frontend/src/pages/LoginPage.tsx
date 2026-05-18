import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      // 역할별 온보딩 페이지로 이동
      if (user.role === 'counselor') {
        navigate('/onboarding/counselor');
      } else if (user.role === 'client') {
        navigate('/onboarding/client');
      } else {
        navigate('/');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 423) {
          setError('계정이 잠겼습니다. 15분 후 다시 시도해주세요');
        } else if (err.status === 401 || err.status === 400) {
          setError('이메일 또는 비밀번호가 일치하지 않습니다');
        } else {
          setError(err.message || '로그인에 실패했습니다');
        }
      } else {
        setError('네트워크 오류가 발생했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-surface-canvas">
      {/* 브랜드 패널 (항상 다크 배경) */}
      <div className="hidden lg:flex lg:w-[600px] relative overflow-hidden bg-brand-deep">
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 50%, var(--accent-warm) 0%, transparent 50%),
                             radial-gradient(circle at 80% 20%, var(--brand-primary) 0%, transparent 40%),
                             radial-gradient(circle at 60% 80%, var(--accent-cool) 0%, transparent 45%)`,
          }}
        />

        <div className="relative z-10 flex flex-col justify-between p-16 w-full">
          <div>
            <h1 className="font-display text-5xl font-light text-ink-on-brand tracking-tight leading-tight">
              Mind Breeze
            </h1>
            <p className="mt-6 text-lg text-ink-on-brand/70 leading-relaxed">
              과학으로 검증된 평온함.
              <br />
              AI가 기록하고, 뇌파가 증명하며,
              <br />
              사람이 결정합니다.
            </p>
          </div>

          <div className="flex justify-center">
            <div className="breath-circle">
              <div className="breath-ring breath-ring--outer" />
              <div className="breath-ring breath-ring--middle" />
              <div className="breath-ring breath-ring--inner" />
            </div>
          </div>

          <div className="space-y-4">
            {[
              { label: 'AI 기반 기록', desc: '세션 내용을 자동으로 기록하고 요약합니다' },
              { label: 'LINK BAND 연동', desc: '실시간 뇌파로 내담자 상태를 과학적으로 파악' },
              { label: '신뢰 기반 플랫폼', desc: '자격·사업자 진위를 AI가 자동 검증' },
            ].map((item) => (
              <div key={item.label} className="flex gap-4 items-start">
                <div className="w-1 h-1 rounded-full bg-accent-warm mt-2 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-ink-on-brand">{item.label}</p>
                  <p className="text-sm text-ink-on-brand/50">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-ink-on-brand/30">
            © 2026 Looxid Labs. All Right Reserved.
          </p>
        </div>
      </div>

      {/* 로그인 폼 */}
      <div className="flex-1 flex items-center justify-center p-8 relative">
        <div className="absolute top-8 right-8">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-[400px] space-y-8">
          <div className="lg:hidden text-center space-y-2">
            <h1 className="font-display text-4xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
            <p className="text-sm text-ink-tertiary">마음의 평화를 과학으로 만나다</p>
          </div>

          <div className="space-y-2">
            <h2 className="font-display text-2xl font-light text-ink-primary">로그인</h2>
            <p className="text-sm text-ink-secondary">준비되시면 시작합니다.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-ink-secondary">
                이메일
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholder="name@example.com"
                disabled={loading}
                className={`w-full h-11 px-4 rounded-xl bg-surface-raised border text-sm text-ink-primary placeholder:text-ink-tertiary transition-all duration-150 outline-none disabled:opacity-50
                  ${emailFocused
                    ? 'border-brand-primary ring-2 ring-brand-primary/15'
                    : 'border-border-default hover:border-border-strong'
                  }`}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <label htmlFor="password" className="block text-sm font-medium text-ink-secondary">
                  비밀번호
                </label>
                <Link to="/forgot-password" className="text-xs text-ink-tertiary hover:text-brand-primary transition-colors">
                  비밀번호를 잊으셨나요
                </Link>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                placeholder="••••••••"
                disabled={loading}
                className={`w-full h-11 px-4 rounded-xl bg-surface-raised border text-sm text-ink-primary placeholder:text-ink-tertiary transition-all duration-150 outline-none disabled:opacity-50
                  ${passwordFocused
                    ? 'border-brand-primary ring-2 ring-brand-primary/15'
                    : 'border-border-default hover:border-border-strong'
                  }`}
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-11 rounded-pill bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-active disabled:bg-surface-sunken text-ink-on-brand disabled:text-ink-disabled font-medium text-sm transition-all duration-150 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="breath-circle" style={{ width: '24px', height: '24px' } as React.CSSProperties}>
                  <div className="breath-ring breath-ring--outer" />
                  <div className="breath-ring breath-ring--middle" />
                  <div className="breath-ring breath-ring--inner" />
                </div>
              ) : (
                '로그인'
              )}
            </button>
          </form>

          <p className="text-center text-sm text-ink-tertiary">
            아직 계정이 없으신가요?{' '}
            <Link to="/register" className="text-brand-primary hover:text-brand-primary-hover font-medium transition-colors">
              회원가입
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
