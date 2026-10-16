// SDD-208 H2 — "손든 회원" 시트: 기존 SpeakingRightsPanel(손든 회원 우선 정렬 + 발언권 부여/해제)을 그대로 재사용한다.
import type { ReactNode } from 'react';
import '../host-player.css';

interface HandsSheetProps {
  /** 컨테이너가 만든 SpeakingRightsPanel(없으면 온라인 그룹이 아니라 발언권을 관리하지 않는 수업) */
  panel: ReactNode | null;
}

export function HandsSheet({ panel }: HandsSheetProps) {
  return (
    <div className="hp-sheet">
      {panel ? <div className="hp-legacy">{panel}</div> : <p className="hp-note">이 수업은 발언권을 따로 관리하지 않아요.</p>}
      <p className="hp-note">발언권을 주면 회원 마이크가 켜져요. 켜진 구간은 AI 기록에 포함돼요.</p>
    </div>
  );
}
