import { useClassApply } from './use-class-apply';
import { useClasses } from '../../hooks/use-class-structure';
import { adaptMemberClass } from '../../lib/class-structure/adapters';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadStateView } from '../../components/class/structure/read-state';
import { MemberClassCard, MemberClassStyles, memberValue } from '../../components/class/structure/member-class-views';

export function MemberClassesPage() {
  const { state, retry } = useClasses();
  const { openApply, overlay } = useClassApply();
  const items = state.status === 'success' ? state.data.classes.map(adaptMemberClass) : [];
  const groups = [
    { label: '참여 중', items: items.filter((item) => memberValue(item.status) === 'active') },
    { label: '완료', items: items.filter((item) => memberValue(item.status) === 'completed') },
    { label: '기타 상태', items: items.filter((item) => !['active', 'completed'].includes(memberValue(item.status) ?? '')) },
  ];
  return <StructureShell role="member" title="내 클래스" rightSlot={<button type="button" className="h-11 rounded-full bg-[#5F0080] px-4 text-sm font-semibold text-white" onClick={openApply}>클래스 신청하기</button>}><MemberClassStyles /><div className="mc-stack">
    <ReadStateView status={state.status === 'success' && items.length === 0 ? 'empty' : state.status} backTo="/app/classes" onRetry={retry}>
      <p className="mc-muted">클래스 상태와 진행을 확인해 보세요. 진행은 개인 출석을 의미하지 않아요.</p>
      {groups.filter((group) => group.items.length > 0).map((group) => <section key={group.label} aria-label={group.label}><h2 className="mc-heading">{group.label}</h2><div className="mc-grid">{group.items.map((item) => <MemberClassCard key={item.id} model={item} />)}</div></section>)}
    </ReadStateView>
  </div>{overlay}</StructureShell>;
}
