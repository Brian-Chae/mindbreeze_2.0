// SDD-208 — 회원 상단 바: 나가기 · 제목 필(시계·진행 바) · 연결 표시. 좌우 요소는 같은 44px 라 한쪽이 달라도 대칭(S3)이다.
import { LogOut, Wifi, WifiOff } from 'lucide-react';
import type { MemberCase } from '../../../../lib/class/member-player-case';
import { IconCircleButton } from '../shared/IconCircleButton';
import { PlayerTopBar } from '../shared/PlayerTopBar';
import { MemberBrandMark } from './MemberBrandMark';
import { formatClock } from './member-metrics';
import type { MemberHeaderModel } from './member-view-types';
import './member-player.css';

interface MemberTopBarProps {
  header: MemberHeaderModel;
  conn: MemberCase['conn'];
  onLeave: () => void;
}

export function MemberTopBar({ header, conn, onLeave }: MemberTopBarProps) {
  const progress = header.totalSec > 0 ? Math.min(100, Math.max(0, (header.elapsedSec / header.totalSec) * 100)) : 0;
  return (
    <PlayerTopBar
      variant="member"
      left={<IconCircleButton label="나가기" icon={<LogOut size={24} strokeWidth={2} />} pz="leave" onClick={onLeave} />}
      center={
        <div className="mp-title-pill">
          <MemberBrandMark className="mp-title-pill__logo" />
          <div className="mp-title-pill__text">
            <h1 className="mp-title-pill__title">{header.title}</h1>
            <p className="mp-title-pill__time"><b>{formatClock(header.elapsedSec)}</b> / {formatClock(header.totalSec)}</p>
          </div>
          <div className="mp-title-pill__bar" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
        </div>
      }
      right={
        <div className="mp-conn" data-pz="conn" data-ok={conn.ok ? 'true' : 'false'} role="status" aria-label={conn.label}>
          {conn.icon === 'dot' ? <i className="mp-conn__dot" /> : (
            <span className="mp-conn__ic">{conn.icon === 'wifi' ? <Wifi size={20} strokeWidth={2} aria-hidden="true" /> : <WifiOff size={20} strokeWidth={2} aria-hidden="true" />}</span>
          )}
          <span className="mp-conn__txt">{conn.label}</span>
        </div>
      }
    />
  );
}
