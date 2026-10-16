// SDD-208 H2 — "도구" 시트: 정렬 · 손든 회원 우선 · 표로 보기 · 내 밴드 · 참여 코드(복사).
import { Copy, Hand, Table2, Watch } from 'lucide-react';
import type { HostSort } from '../../../../../lib/class/host-player-case';
import { HostRow, HostSection, HostSwitch } from '../HostAtoms';
import '../host-player.css';

interface ToolsSheetProps {
  sort: HostSort;
  onSort: (sort: HostSort) => void;
  /** 온라인 그룹에서만 손든 회원 우선 정렬을 둔다 */
  showHandsFirst: boolean;
  handsFirst: boolean;
  onHandsFirst: (on: boolean) => void;
  table: boolean;
  onTable: (on: boolean) => void;
  accessCode: string;
  codeCopied: boolean;
  onCopyCode: () => void;
  /** 내 밴드 줄 부제(연결됨·미착용 …) */
  selfBandText: string;
  onOpenMyband: () => void;
}

const SORTS: readonly { key: HostSort; label: string }[] = [
  { key: 'join', label: '입장순' },
  { key: 'low', label: '낮은 순' },
  { key: 'high', label: '높은 순' },
];

export function ToolsSheet({
  sort, onSort, showHandsFirst, handsFirst, onHandsFirst, table, onTable, accessCode, codeCopied, onCopyCode, selfBandText, onOpenMyband,
}: ToolsSheetProps) {
  return (
    <div className="hp-sheet">
      <HostSection label="정렬">
        <div className="hp-segs" role="radiogroup" aria-label="정렬">
          {SORTS.map((s) => (
            <button key={s.key} type="button" role="radio" className="hp-seg" aria-checked={sort === s.key} onClick={() => onSort(s.key)}>{s.label}</button>
          ))}
        </div>
      </HostSection>
      {showHandsFirst ? (
        <HostRow
          lead={<span className="hp-row__lead"><Hand aria-hidden="true" strokeWidth={2} /></span>}
          title="손든 회원 우선"
          sub="손든·말하는 회원을 맨 위에"
          trailing={<HostSwitch checked={handsFirst} label="손든 회원 우선" onChange={onHandsFirst} />}
        />
      ) : null}
      <HostRow
        lead={<span className="hp-row__lead"><Table2 aria-hidden="true" strokeWidth={2} /></span>}
        title="표로 보기"
        sub="6개 지표를 한눈에 비교"
        trailing={<HostSwitch checked={table} label="표로 보기" onChange={onTable} />}
      />
      <HostRow
        lead={<span className="hp-row__lead"><Watch aria-hidden="true" strokeWidth={2} /></span>}
        title="내 밴드"
        sub={selfBandText}
        trailing={<button type="button" className="hp-btn" data-variant="ghost" onClick={onOpenMyband}>보기</button>}
      />
      <HostSection label="참여 코드">
        <div className="hp-code">
          <b>{accessCode || '——————'}</b>
          <button type="button" className="hp-btn" disabled={!accessCode} onClick={onCopyCode}>
            <Copy aria-hidden="true" strokeWidth={2} />{codeCopied ? '복사 완료' : '코드 복사'}
          </button>
        </div>
      </HostSection>
    </div>
  );
}
