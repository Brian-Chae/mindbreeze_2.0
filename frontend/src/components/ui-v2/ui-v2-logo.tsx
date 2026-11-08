// SDD-318 — 상단 로고(디자인 시스템 정본 락업): 심볼 + 워드마크 "MIND BREEZE"(항상 대문자).
// 심볼 파일은 기존 /mb-design/assets/logo_symbol_dark.svg 를 그대로 쓴다(복제 없음). 크기·간격 규칙은 ui-v2-brand.css.
import { Link } from 'react-router-dom';
import '../../styles/ui-v2-brand.css';

export function UiV2Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/app" className="u2-logo" aria-label="MIND BREEZE 홈" data-compact={compact || undefined}>
      <img className="u2-logo-symbol" src="/mb-design/assets/logo_symbol_dark.svg" alt="" width={26} height={12} />
      <span className="u2-logo-word" aria-hidden="true">MIND&nbsp;BREEZE</span>
    </Link>
  );
}
