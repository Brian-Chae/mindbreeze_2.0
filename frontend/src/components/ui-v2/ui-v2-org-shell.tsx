// SDD-321 기관 정합(11/9) — 기관 관리자 셸. 코치와 같은 공유 AppShell(좌측 216px 보라 사이드바·상단 제목·하단 플로팅 메뉴)을 쓰고,
// 본문은 코치 화면과 같은 래퍼(.ui-v2 u2f)에 올린다. 사이드바·모바일 메뉴 모양은 html.u2-coach 스코프(ui-v2-pc.css·ui-v2-coach.css)가 입힌다.
import type { ReactNode } from 'react';
import AppShell from '../layout/AppShell';
import '../../styles/ui-v2.css';
import '../../styles/ui-v2-brand.css';
import '../../styles/ui-v2-org.css';
import '../../styles/ui-v2-coach-screens.css';
import '../../styles/ui-v2-coach-pc.css';

export interface UiV2OrgShellProps {
  title: string;
  subtitle?: string;
  /** 큰 제목 오른쪽에 놓는 행동(예: 코치 초대). */
  actions?: ReactNode;
  children: ReactNode;
}

export function UiV2OrgShell({ title, subtitle, actions, children }: UiV2OrgShellProps) {
  return (
    <AppShell title={title} sub={subtitle} rightSlot={actions}>
      <div className="ui-v2 u2f u2f-org">{children}</div>
    </AppShell>
  );
}
