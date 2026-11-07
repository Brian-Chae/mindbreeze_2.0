// SDD-318 — 클래스 목록(D안). 신청·코드 입장·코드 가입·상태별 그룹은 기존 로직을 그대로 쓴다.
import { Link } from 'react-router-dom';
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import { UiV2ArcRing } from '../../../components/ui-v2/ui-v2-arc-ring';
import { natureHeroStyle } from '../../../components/ui-v2/nature-hero';
import { ReadStateView } from '../../../components/class/structure/read-state';
import { membershipLabels, memberDate, memberStatus, memberValue } from '../../../components/class/structure/member-class-views';
import { CodeEntryButton } from '../../../components/client/code-entry-button';
import { useClassApply } from '../use-class-apply';
import { MemberCodeJoin } from '../member-classes-page';
import { useClientCounselors } from '../../../hooks/use-client-counselors';
import { useClasses } from '../../../hooks/use-class-structure';
import { adaptMemberClass, type ClassReadModel } from '../../../lib/class-structure/adapters';
import { classCardCopy } from '../../../lib/class-structure/class-card-copy';
import { classPath } from '../../../lib/class-structure/navigation';
import type { MembershipMember } from '../../../lib/api/class-operations';

const dateOf = (iso: string) => memberDate({ kind: 'value', value: iso });

function ClassCard({ model, membership, featured }: { model: ClassReadModel; membership?: MembershipMember | null; featured: boolean }) {
  const copy = classCardCopy(model, dateOf);
  const status = memberStatus(model.status);
  const memberLabel = membership ? `${membershipLabels[membership.status] ?? membership.status}${membership.waitlist_position != null ? ` · ${membership.waitlist_position}번` : ''}` : null;
  return (
    <Link className={`u2-card${featured ? ' u2-hero u2-hero--nature' : ''}`} style={featured ? natureHeroStyle(model.id) : undefined} to={classPath('member', model.id)}>
      {featured && <UiV2ArcRing variant="hero" />}
      <span className="u2-chip">{[status, memberLabel].filter(Boolean).join(' · ') || '클래스'}</span>
      <h2 style={{ marginTop: 14 }}>{copy.title}</h2>
      {copy.progress ? <>
        <div className="u2-num">{String(copy.progress.completed).padStart(2, '0')} <span>/ {String(copy.progress.total).padStart(2, '0')}회</span></div>
        <small>클래스 전체 진행 · 개인 출석과 별개</small>
      </> : copy.completedOnly !== null ? <p className="u2-muted">완료한 회차 {copy.completedOnly}회</p> : null}
      <p className="u2-muted">{copy.nextHeadline}{copy.nextDetail ? <><br />{copy.nextDetail}</> : null}{copy.host ? <><br />지도사 {copy.host}</> : null}</p>
      <div className="u2-textlink" aria-hidden="true">{featured ? '회차 살펴보기 ↗' : '클래스 보기 ↗'}</div>
    </Link>
  );
}

export function UiV2ClassesPage() {
  useClientCounselors();
  const { state, retry } = useClasses();
  const { openApply, overlay } = useClassApply();
  const items = state.status === 'success' ? state.data.classes.map(adaptMemberClass) : [];
  const memberships = new Map(state.status === 'success' ? state.data.classes.map((item) => [item.id, item.membership]) : []);
  const status = (item: ClassReadModel) => memberships.get(item.id)?.status ?? memberValue(item.status);
  const groups = [
    { label: '참여 중', items: items.filter((i) => status(i) === 'active') },
    { label: '완료', items: items.filter((i) => status(i) === 'completed') },
    { label: '대기 중', items: items.filter((i) => status(i) === 'waitlisted') },
    { label: '이탈', items: items.filter((i) => ['left', 'removed'].includes(status(i) ?? '')) },
    { label: '기타 상태', items: items.filter((i) => !['active', 'completed', 'waitlisted', 'left', 'removed'].includes(status(i) ?? '')) },
  ].filter((g) => g.items.length > 0);
  return (
    <UiV2ClientShell title="내 클래스" subtitle="한 번의 호흡에서, 다음 만남으로.">
      <div className="u2-split">
        <CodeEntryButton variant="secondary" placement="inline" />
        <button type="button" className="u2-primary" onClick={openApply}>클래스 신청하기</button>
      </div>
      <ReadStateView status={state.status === 'success' && items.length === 0 ? 'empty' : state.status} backTo="/app/classes" onRetry={retry}>
        <p className="u2-footnote">클래스 상태와 진행을 확인해 보세요. 진행은 개인 출석을 의미하지 않아요.</p>
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <div className="u2-section-head u2-row"><h2>{group.label}</h2><small>{group.items.length}개</small></div>
            {group.items.map((item, index) => <ClassCard key={item.id} model={item} membership={memberships.get(item.id)} featured={group.label === '참여 중' && index === 0} />)}
          </section>
        ))}
      </ReadStateView>
      <div className="u2-gap"><MemberCodeJoin /></div>
      {overlay}
    </UiV2ClientShell>
  );
}
