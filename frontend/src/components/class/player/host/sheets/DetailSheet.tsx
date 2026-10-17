// SDD-208 H3 — 참가자 상세 시트: 6지표 + 최근 5분 추이 + 체크인 응답(타일·체크인 시트의 "살펴볼 응답"에서 연다).
import type { HostParticipant } from '../../../../../lib/class/host-player-case';
import type { PlayerMetric } from '../../../../../lib/class/player-case';
import { HostMinis, HostQaCard, HostTrendCard } from '../HostPersonParts';
import '../host-player.css';

interface DetailSheetProps {
  participant: HostParticipant;
  metric: PlayerMetric;
  trend: readonly number[];
}

export function DetailSheet({ participant, metric, trend }: DetailSheetProps) {
  return (
    <div className="hp-sheet">
      <HostMinis participant={participant} selected={metric.key} />
      <HostTrendCard participant={participant} metric={metric} points={trend} />
      <HostQaCard participant={participant} card={false} />
    </div>
  );
}
