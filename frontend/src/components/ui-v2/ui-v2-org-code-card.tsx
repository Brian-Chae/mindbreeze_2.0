// SDD-321 C(11/9) — 기관 코드를 코치 코드 카드와 같은 모양으로 홈 최상단에 크게 보여 준다(전체 표시 + 복사).
import { useState, type ReactElement } from 'react';
import { natureHeroStyle } from './nature-hero';

export function UiV2OrgCodeCard({ orgCode }: { orgCode: string | null }): ReactElement | null {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    if (!orgCode) return;
    try {
      await navigator.clipboard.writeText(orgCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* 클립보드 실패 시 숫자를 직접 보고 전달 */ }
  };
  return (
    <section className="u2-card u2-coach-code u2-hero--nature u2-org-code-hero" style={natureHeroStyle('org-code')} aria-label="우리 기관 코드" data-testid="org-code-card">
      <div className="u2-coach-code__text">
        <span className="u2-eyebrow">기관 코드</span>
        <strong className="u2-coach-code__num" aria-label={orgCode ? `기관 코드 ${orgCode.split('').join(' ')}` : '기관 코드 미발급'}>{orgCode ?? '미발급'}</strong>
        <small>코치가 기관에 가입할 때 이 코드를 입력하면 우리 기관과 연결돼요.</small>
      </div>
      {orgCode && <button type="button" className="u2-coach-code__copy" onClick={() => void copy()}>{copied ? '복사됨' : '복사'}</button>}
    </section>
  );
}
