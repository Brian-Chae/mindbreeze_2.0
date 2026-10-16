// SDD-208 H2 — "입장 대기" 시트(읽기 전용). 입장 승인 API 가 없어 자리가 나면 자동으로 입장한다(plan B4 미적용).
// 준비 현황(WaitingRoomReadinessPanel)은 대기실 구독이 켜져 있을 때만 컨테이너가 넘겨 준다.
import type { ReactNode } from 'react';
import type { HostQueueEntry } from '../../../../../lib/class/host-player-case';
import { HostAvatar, HostRow } from '../HostAtoms';
import '../host-player.css';

interface QueueSheetProps {
  queue: readonly HostQueueEntry[];
  readinessPanel?: ReactNode;
}

export function QueueSheet({ queue, readinessPanel }: QueueSheetProps) {
  return (
    <div className="hp-sheet">
      {queue.length ? queue.map((entry) => (
        <HostRow key={entry.id} lead={<HostAvatar name={entry.name} />} title={entry.name} sub="자리 대기 중" />
      )) : <p className="hp-note">대기 중인 회원이 없어요.</p>}
      <p className="hp-note">자리가 나면 자동으로 입장해요.</p>
      {readinessPanel ? <div className="hp-legacy">{readinessPanel}</div> : null}
    </div>
  );
}
