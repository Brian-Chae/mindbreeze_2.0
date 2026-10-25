// SDD-209 SH2 — 클래스 한 줄 행(홈 이번 주 클래스·받은 초대). 카드보다 가벼운 목록 단위.
import type { ReactNode } from 'react';
import type { ClassChipKey } from '../../../../lib/class/class-labels';
import { StatusChip } from './StatusChip';
import './shell-kit.css';

export interface ClassRowData {
  id: string;
  title: string;
  /** `내일 오전 10:00 · 김하늘 상담사` */
  sub: string;
  chip: ClassChipKey;
}

interface ClassRowProps {
  data: ClassRowData;
  onOpen: (id: string) => void;
}

export function ClassRow({ data, onOpen }: ClassRowProps) {
  return (
    <button type="button" className="sh-card sh-row" data-testid="class-row" onClick={() => onOpen(data.id)}>
      <span className="sh-row__tx">
        <b>{data.title}</b>
        {/* 일시 · 진행자를 두 줄로 나눠 오른쪽 상태 칩이 한 줄을 유지할 공간을 확보한다. */}
        {data.sub.split(' · ').map((line, i) => <span key={i} className="sh-row__sub">{line}</span>)}
      </span>
      <StatusChip chip={data.chip} />
    </button>
  );
}

interface EmptyRowProps {
  icon: ReactNode;
  title: string;
  sub: string;
}

/** 비어 있는 목록 자리(행과 같은 높이로 안내) */
export function EmptyRow({ icon, title, sub }: EmptyRowProps) {
  return (
    <div className="sh-card sh-row" data-testid="empty-row">
      <span className="sh-row__lead">
        <span className="sh-row__ic">{icon}</span>
        <span className="sh-row__tx">
          <b>{title}</b>
          <span>{sub}</span>
        </span>
      </span>
    </div>
  );
}
