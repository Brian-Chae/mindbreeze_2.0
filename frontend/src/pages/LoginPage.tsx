import { useState, FormEvent } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex bg-surface-canvas">
      {/* 브랜드 패널 */}
      <div className="hidden lg:flex lg:w-[600px] relative overflow-hidden bg-brand-deep">
        {/* 배경 텍스처 */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 50%, var(--accent-warm) 0%, transparent 50%),
                             radial-gradient(circle at 80% 20%, var(--brand-primary) 0%, transparent 40%),
                             radial-gradient(circle at 60% 80%, var(--accent-cool) 0%, transparent 45%)`,
          }}
        />

        {/* 콘텐츠 */}
        <div className="relative z-10 flex flex-col justify-between p-16 w-full">
          {/* 로고 + 슬로건 */}
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

          {/* Breath Circle 장식 */}
          <div className="flex justify-center">
            <div className="breath-circle">
              <div className="breath-ring breath-ring--outer" />
              <div className="breath-ring breath-ring--middle" />
              <div className="breath-ring breath-ring--inner" />
            </div>
          </div>

          {/* 특장점 */}
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

          {/* 푸터 */}
          <p className="text-xs text-ink-on-brand/30">
            © 2026 Looxid Labs. All Right Reserved.
          </p>
        </div>
      </div>

      {/* 로그인 폼 */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[400px] space-y-8">
          {/* 모바일 로고 */}
          <div className="lg:hidden text-center space-y-2">
            <h1 className="font-display text-4xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
            <p className="text-sm text-ink-tertiary">마음의 평화를 과학으로 만나다</p>
          </div>

          {/* 헤더 */}
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-light text-ink-primary">
              로그인
            </h2>
            <p className="text-sm text-ink-secondary">
              준비되시면 시작합니다.
            </p>
          </div>

          {/* 폼 */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 이메일 */}
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
                className={`w-full h-11 px-4 rounded-xl bg-surface-raised border text-sm text-ink-primary placeholder:text-ink-tertiary transition-all duration-150 outline-none
                  ${emailFocused
                    ? 'border-brand-primary ring-2 ring-brand-primary/15'
                    : 'border-border-default hover:border-border-strong'
                  }`}
              />
            </div>

            {/* 비밀번호 */}
            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <label htmlFor="password" className="block text-sm font-medium text-ink-secondary">
                  비밀번호
                </label>
                <a href="#" className="text-xs text-ink-tertiary hover:text-brand-primary transition-colors">
                  비밀번호를 잊으셨나요
                </a>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                placeholder="••••••••"
                className={`w-full h-11 px-4 rounded-xl bg-surface-raised border text-sm text-ink-primary placeholder:text-ink-tertiary transition-all duration-150 outline-none
                  ${passwordFocused
                    ? 'border-brand-primary ring-2 ring-brand-primary/15'
                    : 'border-border-default hover:border-border-strong'
                  }`}
              />
            </div>

            {/* 로그인 버튼 */}
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

          {/* 소셜 로그인 */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border-subtle" />
              <span className="text-xs text-ink-tertiary">또는</span>
              <div className="flex-1 h-px bg-border-subtle" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button className="h-11 rounded-pill border border-border-default hover:border-border-strong hover:bg-surface-elevated text-sm text-ink-secondary transition-all duration-150 flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Google
              </button>
              <button className="h-11 rounded-pill border border-border-default hover:border-border-strong hover:bg-surface-elevated text-sm text-ink-secondary transition-all duration-150 flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#FFE812" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path fill="#3C1E1E" d="M8.53 10.22l-.55 1.98-.84.01c-.76-1.04-1.2-2.34-1.2-3.72 0-1.3.4-2.53 1.08-3.54l.74.14.65 1.47-.42.62a3.5 3.5 0 0 0-.35 1.32c0 .48.1.93.27 1.35l.62-.63z"/><path fill="#3C1E1E" d="M18.34 11.64c-.38 1.43-1.26 2.61-2.47 3.22l-.99-.05-.7-1.24.42-.6c.44-.24.82-.6 1.1-1.03l-.62-.63.55-1.98-.84-.01c-.4-.58-.89-1.04-1.44-1.38l-.62.62-.65-1.47.74-.14c1-.88 2.26-1.4 3.63-1.4 1.2 0 2.33.37 3.26 1.01l-1.97 2.08z"/></svg>
                Kakao
              </button>
            </div>
          </div>

          {/* 회원가입 */}
          <p className="text-center text-sm text-ink-tertiary">
            아직 계정이 없으신가요?{' '}
            <a href="#" className="text-brand-primary hover:text-brand-primary-hover font-medium transition-colors">
              회원가입
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
