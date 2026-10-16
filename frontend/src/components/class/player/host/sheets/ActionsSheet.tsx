// SDD-208 H2 — "필요 조치" 시트: 접촉 확인·배터리 낮음 참가자 목록. 기존 SessionMonitorSummary 를 재사용해 요약 4칸이 그리드 필터를 겸한다.
// "모두에게 안내 보내기"는 상담사→참가자 안내 API 가 없어 두지 않는다(plan D13).
import type { HostFilter, HostParticipant } from '../../../../../lib/class/host-player-case';
import { summarizeMonitorCounts } from '../../../../../lib/class/host-player-case';
import { SessionMonitorSummary } from '../../../../session/SessionMonitorSummary';
import { HostAvatar, HostRow, HostSection } from '../HostAtoms';
import '../host-player.css';

interface ActionsSheetProps {
  participants: readonly HostParticipant[];
  filter: HostFilter | null;
  onFilterToggle: (filter: HostFilter) => void;
}

export function ActionsSheet({ participants, filter, onFilterToggle }: ActionsSheetProps) {
  const leadOff = participants.filter((p) => p.band === 'leadoff');
  const lowBattery = participants.filter((p) => p.lowBattery);
  return (
    <div className="hp-sheet">
      <div className="hp-legacy">
        <SessionMonitorSummary counts={summarizeMonitorCounts(participants)} activeFilter={filter} onFilterToggle={onFilterToggle} />
      </div>
      {leadOff.length ? (
        <HostSection label={`접촉 확인 ${leadOff.length}`}>
          {leadOff.map((p) => (
            <HostRow key={p.id} lead={<HostAvatar name={p.name} />} title={p.name} sub="접촉 불량 · 이마에 밀착" subTone="coral" />
          ))}
        </HostSection>
      ) : null}
      {lowBattery.length ? (
        <HostSection label={`배터리 낮음 ${lowBattery.length}`}>
          {lowBattery.map((p) => (
            <HostRow key={p.id} lead={<HostAvatar name={p.name} />} title={p.name} sub="배터리 낮음 · 충전 안내" subTone="caution" />
          ))}
        </HostSection>
      ) : null}
      {!leadOff.length && !lowBattery.length ? <p className="hp-note">지금 조치가 필요한 참가자가 없어요.</p> : null}
    </div>
  );
}
