// SDD-208 H2 → SDD-299 — "설정" 시트(구 도구): 정원 늘리기 · 참여 안내(입장 코드) · 회원 초대 · 내 밴드 · 화면 이동.
// 정렬·손든 회원 우선·표로 보기는 "분석" 시트(MetricSheet)로 옮겼다.
import type { ReactNode } from 'react';
import { Copy, Watch } from 'lucide-react';
import { HostRow, HostSection } from '../HostAtoms';
import '../host-player.css';

/** 입장 코드는 4자리다(D-4). 값이 아직 없으면 4칸 자리표시 */
export const ENTRY_CODE_PLACEHOLDER = '————';

interface ToolsSheetProps {
  /** 맨 위 구역: 정원 늘리기(클래스 정보를 모르면 생략) */
  capacitySection?: ReactNode;
  accessCode: string;
  codeCopied: boolean;
  onCopyCode: () => void;
  onInvite?: () => void;
  /** 수업을 종료하지 않고 화면만 나간다 */
  onLeave?: () => void;
  /** 내 밴드 줄 부제(연결됨·미착용 …) */
  selfBandText: string;
  onOpenMyband: () => void;
}

export function ToolsSheet({ capacitySection, accessCode, codeCopied, onCopyCode, selfBandText, onOpenMyband, onInvite, onLeave }: ToolsSheetProps) {
  return (
    <div className="hp-sheet">
      {capacitySection}
      <HostSection label="참여 안내 (입장 코드)" title>
        <div className="hp-code">
          <b aria-label={accessCode ? `입장 코드 ${accessCode.split('').join(' ')}` : '입장 코드 없음'}>{accessCode || ENTRY_CODE_PLACEHOLDER}</b>
          <button type="button" className="hp-btn" disabled={!accessCode} onClick={onCopyCode}>
            <Copy aria-hidden="true" strokeWidth={2} />{codeCopied ? '복사 완료' : '코드 복사'}
          </button>
        </div>
        <p className="hp-code__hint">참가자에게 직접 알려 주세요</p>
      </HostSection>
      {onInvite ? (
        <HostSection label="회원 초대" title>
          <button type="button" className="hp-btn min-h-[44px] min-w-[44px]" onClick={onInvite}>회원 초대</button>
        </HostSection>
      ) : null}
      <HostSection label="내 밴드" title>
        <HostRow
          lead={<span className="hp-row__lead"><Watch aria-hidden="true" strokeWidth={2} /></span>}
          title="내 밴드"
          sub={selfBandText}
          trailing={<button type="button" className="hp-btn" data-variant="ghost" onClick={onOpenMyband}>보기</button>}
        />
      </HostSection>
      {onLeave ? (
        <HostSection label="화면 이동" title>
          <button type="button" className="hp-btn" data-variant="ghost" onClick={onLeave}>클래스 화면 나가기</button>
        </HostSection>
      ) : null}
    </div>
  );
}
