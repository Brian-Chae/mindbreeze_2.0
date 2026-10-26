// SDD-208 H2 — "알림 전체" 시트: 칩 줄에서 "+N" 으로 접힌 칩까지 전부 모아 보여 준다.
import { CheckinSheet } from './CheckinSheet';
import { HOST_BAND_TEXT, chipTarget, type HostCheckinSummary, type HostPreCheckin, type HostChip, type HostSheetKey } from '../../../../../lib/class/host-player-case';
import '../host-player.css';

interface AlertsSheetProps {
  chips: readonly HostChip[];
  checkinSummary?: HostCheckinSummary;
  preCheckins?: readonly HostPreCheckin[];
  onDetail?: (id: string) => void;
  onSheet: (sheet: HostSheetKey) => void;
  onToggleHandsFirst: () => void;
}

export function AlertsSheet({ chips, checkinSummary, preCheckins = [], onDetail, onSheet, onToggleHandsFirst }: AlertsSheetProps) {
  const rows = chips.flatMap((chip) => {
    if (chip.key === 'checkin') return [];
    const target = chipTarget(chip);
    return target || chip.key === 'band' ? [{ chip, target }] : [];
  });
  if (!rows.length && !checkinSummary) return <p className="hp-note">확인할 알림이 없어요.</p>;
  return (
    <div className="hp-sheet">
      {checkinSummary ? <section className="hp-status-checkin" aria-label="체크인" >
        <p>자가 체크인 응답 <b>{checkinSummary.responded} / {checkinSummary.total}명</b></p>
        <details><summary>체크인 응답 펼치기</summary>
          <CheckinSheet summary={checkinSummary} preCheckins={preCheckins} onDetail={onDetail ?? (() => undefined)} />
        </details>
      </section> : null}
      {rows.map(({ chip, target }) => (
        <div className="hp-row" key={chip.key}>
          <div className="hp-row__tx"><b>{chip.key === 'band' && chip.solo && chip.soloBand ? `밴드 ${HOST_BAND_TEXT[chip.soloBand]}` : chip.label}</b></div>
          {target && 'sheet' in target ? (
            <button type="button" className="hp-btn" data-variant="ghost" onClick={() => onSheet(target.sheet)}>열기</button>
          ) : target ? (
            <button type="button" className="hp-btn" data-variant="ghost" onClick={onToggleHandsFirst}>바꾸기</button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
