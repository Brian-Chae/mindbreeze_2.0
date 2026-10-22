// SDD-209 SH2 — FM01 회원 홈 본문 뷰(순수 props). 하니스 픽스처가 같은 뷰를 그린다.
// 구성: 히어로(없으면 빈 히어로) → 목록 섹션 → 목록 아래 `코드로 입장하기` 텍스트 버튼.
import type { ReactNode } from 'react';
import { Key } from 'lucide-react';
import type { EnterAction } from '../../../../lib/class/enter-action';
import { ClassHero, ClassHeroEmpty, type ClassHeroData } from './ClassHero';
import { ClassRow, EmptyRow, type ClassRowData } from './ClassRow';
import './shell-kit.css';

export interface HomeSection {
  title: string;
  rows: ClassRowData[];
  /** rows 가 비었을 때 보이는 안내 */
  empty?: { icon: ReactNode; title: string; sub: string };
}

interface MemberHomeViewProps {
  hero: ClassHeroData | null;
  heroAction: EnterAction;
  /** hero 가 null 일 때 빈 히어로 배경 */
  emptyBackdrop?: string;
  sections?: HomeSection[];
  /** 이전 호환: 단일 섹션 */
  rows?: ClassRowData[];
  onHeroAction: () => void;
  onEnterByCode: () => void;
  onApply: () => void;
  onOpenClass: (id: string) => void;
}

export function HomeSectionList({ section, onOpenClass }: { section: HomeSection; onOpenClass: (id: string) => void }) {
  return (
    <>
      <div className="sh-sec"><h2 className="mobile:!text-mb-subtitle">{section.title}</h2><span className="mobile:!text-mb-caption">{section.rows.length}개</span></div>
      {section.rows.length > 0
        ? section.rows.map((row) => <ClassRow key={row.id} data={row} onOpen={onOpenClass} />)
        : section.empty ? <EmptyRow {...section.empty} /> : null}
    </>
  );
}

export function EnterByCodeLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="sh-link mobile:!min-h-12 mobile:!text-mb-label" data-testid="enter-with-code" onClick={onClick}>
      <Key size={20} aria-hidden="true" />코드로 입장하기
    </button>
  );
}

export function MemberHomeView({ hero, heroAction, emptyBackdrop = '/images/background8.webp', sections, rows, onHeroAction, onEnterByCode, onApply, onOpenClass }: MemberHomeViewProps) {
  const list: HomeSection[] = sections ?? (rows && rows.length > 0 ? [{ title: '이번 주 클래스', rows }] : []);
  return (
    <>
      {hero ? <ClassHero data={hero} action={heroAction} onAction={onHeroAction} /> : <ClassHeroEmpty backdropSrc={emptyBackdrop} onApply={onApply} />}
      {list.map((section) => <HomeSectionList key={section.title} section={section} onOpenClass={onOpenClass} />)}
      <EnterByCodeLink onClick={onEnterByCode} />
    </>
  );
}
