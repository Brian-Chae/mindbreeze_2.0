// SDD-209 SH3 — FM02 회원 클래스 목록 본문 뷰(순수 props). 구역별 카드 목록 + 비어 있을 때 안내 한 칸.
import { CalendarX } from 'lucide-react';
import { ClassCard } from './ClassCard';
import { EmptyRow } from './ClassRow';
import type { ClassListSection } from './shell-data';
import './shell-kit.css';

interface MemberClassListViewProps {
  sections: ClassListSection[];
  /** 카드 본문 탭 → 상세 */
  onOpen: (id: string) => void;
  /** 입장하기 */
  onEnter: (id: string) => void;
  /** 초대받은 클래스 확인 */
  onConfirmInvite: (id: string) => void;
  /** id 별 입장 처리 중 */
  enteringId?: string | null;
}

export function MemberClassListView({ sections, onOpen, onEnter, onConfirmInvite, enteringId = null }: MemberClassListViewProps) {
  if (sections.length === 0) {
    return <EmptyRow icon={<CalendarX size={20} aria-hidden="true" />} title="아직 예정된 클래스가 없어요" sub="코치가 클래스를 등록하면 여기에 표시돼요" />;
  }
  return (
    <>
      {sections.map((section) => (
        <section key={section.key} className="sh-list-sec" aria-label={section.title}>
          <div className="sh-sec"><h2>{section.title}</h2><span>{section.entries.length}개</span></div>
          {section.entries.map((entry) => (
            <ClassCard
              key={entry.data.id}
              data={entry.data}
              chip={entry.chip}
              highlight={entry.highlight}
              onOpen={onOpen}
              action={entry.action ? {
                label: entry.action.label,
                line: entry.action.kind === 'confirm',
                disabled: entry.action.kind === 'enter' && enteringId === entry.data.id,
                onClick: entry.action.kind === 'enter' ? onEnter : onConfirmInvite,
              } : undefined}
            />
          ))}
        </section>
      ))}
    </>
  );
}
