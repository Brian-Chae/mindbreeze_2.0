import { Link } from 'react-router-dom';
import { useMixedHome } from '../../hooks/use-class-structure';
import { adaptMixedHome } from '../../lib/class-structure/adapters';
import { displayField } from '../../lib/class-structure/read-model';
import { counselingPath } from '../../lib/class-structure/navigation';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadField, ReadStateView } from '../../components/class/structure/read-state';
import { MemberClassCard, MemberClassStyles, memberDate, memberValue } from '../../components/class/structure/member-class-views';

export function MemberStructureHomePage() {
  const read = useMixedHome();
  const model = adaptMixedHome(read.classes, read.counseling);
  const next = memberValue(model.next);
  const nextSeq = next && memberValue(next.seq);
  const classes = model.classes.status === 'success' ? model.classes.data.classes : [];
  const counseling = model.counseling.status === 'success' ? model.counseling.data.relationships : [];
  return <StructureShell role="member" title="안녕하세요"><MemberClassStyles /><div className="mc-stack">
    <section className="mc-card mc-hero" aria-label="다음 일정" data-area={next?.area}>
      <span className="mc-chip">{model.nextIsComplete ? '다음 일정' : '확인된 다음 일정'}</span>
      {next ? <><h2>{next.area === 'meditation' ? <><ReadField value={memberValue(next.title)} /> · <ReadField value={nextSeq == null ? undefined : `${nextSeq}회차`} /></> : <ReadField value={nextSeq == null ? undefined : `상담 ${nextSeq}회차`} />}</h2>
        <p className="mc-muted"><ReadField value={memberDate(displayField(next.scheduledAt))} /></p>
        <p className="mc-muted">{next.area === 'meditation' ? '지도사' : '상담사'} · <ReadField value={memberValue(next.hostName)} /></p>
        <Link className="mc-link mc-primary" to={`/class/${encodeURIComponent(next.sessionId)}/enter`}>입장하기</Link></>
        : <h2>{model.nextIsComplete ? '예정된 일정이 없어요' : '일정을 확인하고 있어요'}</h2>}
    </section>
    <section aria-label="내 클래스" data-area="meditation"><div className="mc-row"><h2 className="mc-heading">내 클래스</h2><Link className="mc-link" to="/app/classes">전체 보기</Link></div>
      <ReadStateView status={model.classes.status === 'success' && classes.length === 0 ? 'empty' : model.classes.status} backTo="/app/classes" onRetry={read.retry}>
        <div className="mc-grid">{classes.map((item) => <MemberClassCard key={item.id} model={item} />)}</div>
      </ReadStateView>
    </section>
    <section aria-label="내 상담" data-area="counseling"><div className="mc-row"><h2 className="mc-heading">내 상담</h2><Link className="mc-link" to="/app/counseling">전체 보기</Link></div>
      <ReadStateView area="counseling" status={model.counseling.status === 'success' && counseling.length === 0 ? 'empty' : model.counseling.status} backTo="/app/counseling" onRetry={read.retry}>
        <div className="mc-grid">{counseling.map((item) => <article className="mc-card" key={item.id}><Link className="mc-card-link" to={counselingPath('member', item.id)}><h3>상담 일정</h3><p className="mc-muted">상담사 · <ReadField value={memberValue(item.counselorName)} /></p><p className="mc-muted">다음 상담 · <ReadField value={item.nextSession.kind === 'value' ? memberDate(item.nextSession.value.scheduledAt) : undefined} /></p></Link></article>)}</div>
      </ReadStateView>
    </section>
    <Link className="mc-link" to="/join">코드로 입장하기</Link>
  </div></StructureShell>;
}
