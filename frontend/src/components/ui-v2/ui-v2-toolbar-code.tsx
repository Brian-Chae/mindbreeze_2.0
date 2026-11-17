// 회원 상단 바(종 버튼 왼쪽)의 [코드로 바로 입장] 알약 버튼 — 홈·내 클래스 공용. 링크는 /join.
import { Link } from 'react-router-dom';
import { Key } from 'lucide-react';

export function UiV2ToolbarCode() {
  return (
    <Link to="/join" data-testid="enter-with-code" data-code-entry="toolbar" className="u2-toolbar-code">
      <Key size={16} aria-hidden="true" /><span>코드로 바로 입장</span>
    </Link>
  );
}
