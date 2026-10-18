// 개인정보 처리방침 — 로그인 없이 열람하는 공개 페이지

import { Link } from 'react-router-dom';
import {
  PRIVACY_ARTICLES,
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_EFFECTIVE_ISO,
  PRIVACY_POLICY_VERSION,
} from '../lib/privacy-policy';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-surface-canvas">
      <main className="mx-auto w-full max-w-3xl px-5 py-10 md:py-16">
        <nav aria-label="돌아가기" className="mb-6">
          <Link to="/" className="inline-flex min-h-11 items-center text-sm text-ink-secondary hover:text-ink-primary">
            ← MIND BREEZE 홈
          </Link>
        </nav>
        <header className="mb-8 border-b border-[var(--mb-border)] pb-6">
          <h1 className="font-display text-2xl font-light text-ink-primary md:text-3xl">개인정보 처리방침</h1>
          <p className="mt-3 text-sm text-ink-secondary">
            시행일 <time dateTime={PRIVACY_POLICY_EFFECTIVE_ISO}>{PRIVACY_POLICY_EFFECTIVE_DATE}</time> · 버전 {PRIVACY_POLICY_VERSION}
          </p>
        </header>

        <nav aria-label="목차" className="mb-10 rounded-xl border border-[var(--mb-border)] p-4">
          <ol className="grid gap-1 text-sm md:grid-cols-2">
            {PRIVACY_ARTICLES.map((a) => (
              <li key={a.id}>
                <a href={`#${a.id}`} className="inline-flex min-h-8 items-center text-ink-secondary hover:text-brand-primary">
                  {a.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-10">
          {PRIVACY_ARTICLES.map((a) => (
            <section key={a.id} id={a.id} aria-labelledby={`${a.id}-title`} className="scroll-mt-6">
              <h2 id={`${a.id}-title`} className="mb-3 text-lg font-semibold text-ink-primary">{a.title}</h2>
              <ol className="list-decimal space-y-2 pl-5 text-[15px] leading-7 text-ink-primary marker:text-ink-secondary">
                {a.items.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ol>
            </section>
          ))}
        </div>

        <footer className="mt-14 border-t border-[var(--mb-border)] pt-6 text-sm text-ink-secondary">
          시행일 {PRIVACY_POLICY_EFFECTIVE_DATE} · 버전 {PRIVACY_POLICY_VERSION}
        </footer>
      </main>
    </div>
  );
}
