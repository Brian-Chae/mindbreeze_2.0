// 11/9 대표 지시 — 코치 코드는 가리지 않고 전체 숫자를 홈·클래스 최상단에 크게 보여 준다.
import { useState, type ReactElement } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { natureHeroStyle } from './nature-hero';

export function UiV2CoachCodeCard(): ReactElement | null {
  const code = useAuthStore((s) => s.user?.counselor_code ?? null);
  const role = useAuthStore((s) => s.user?.role);
  const [copied, setCopied] = useState(false);
  if (role !== 'counselor' || !code) return null;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* 클립보드 실패 시 숫자를 직접 보고 전달 */ }
  };
  return (
    <section className="u2-card u2-coach-code u2-hero--nature u2-org-code-hero" style={natureHeroStyle('coach-code')} aria-label="내 코치 코드" data-testid="coach-code-card">
      <div className="u2-coach-code__text">
        <span className="u2-eyebrow">내 코치 코드</span>
        <strong className="u2-coach-code__num" aria-label={`코치 코드 ${code.split('').join(' ')}`}>{code}</strong>
        <small>회원이 가입할 때 이 숫자를 입력하면 코치와 연결돼요.</small>
      </div>
      <button type="button" className="u2-coach-code__copy" onClick={() => void copy()}>{copied ? '복사됨' : '복사'}</button>
    </section>
  );
}
