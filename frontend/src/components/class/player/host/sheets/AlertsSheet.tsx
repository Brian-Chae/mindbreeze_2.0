// SDD-208 H2 — "알림 전체" 시트: 칩 줄에서 "+N" 으로 접힌 칩까지 전부 모아 보여 준다.
import { HOST_BAND_TEXT, chipTarget, type HostChip, type HostSheetKey } from '../../../../../lib/class/host-player-case';
import '../host-player.css';

interface AlertsSheetProps {
  chips: readonly HostChip[];
  onSheet: (sheet: HostSheetKey) => void;
  onToggleHandsFirst: () => void;
}

export function AlertsSheet({ chips, onSheet, onToggleHandsFirst }: AlertsSheetProps) {
  const rows = chips.flatMap((chip) => {
    const target = chipTarget(chip);
    return target || chip.key === 'band' ? [{ chip, target }] : [];
  });
  if (!rows.length) return <p className="hp-note">확인할 알림이 없어요.</p>;
  return (
    <div className="hp-sheet">
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
