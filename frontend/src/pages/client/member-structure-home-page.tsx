import { HOME_CLASS_LIMIT } from '../../lib/dashboard/counselor-home-model';
import { MemberClassStrip } from '../../components/client/home/member-class-strip';
import '../../components/client/home/member-home-layout.css';
import '../../components/client/home/home-card-parity.css';
import { Link } from 'react-router-dom';
import { isCounselingEnabled } from '../../lib/feature-flags';
import { useAuthStore } from '../../stores/authStore';
import { heroBackdrop } from '../../components/class/flow/shell/shell-data';
import '../../components/class/flow/shell/shell-kit.css';
import { CodeEntryButton } from '../../components/client/code-entry-button';
import ClientHomePage from './ClientHomePage';
import { useClientCounselors } from '../../hooks/use-client-counselors';
import { useMixedHome } from '../../hooks/use-class-structure';
import { adaptMixedHome } from '../../lib/class-structure/adapters';
import { displayField } from '../../lib/class-structure/read-model';
import { counselingPath } from '../../lib/class-structure/navigation';
import type { RelationshipId } from '../../lib/class-structure/read-model';
import { startedAgoLabel } from '../../lib/class-structure/home-next';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadField, ReadStateView } from '../../components/class/structure/read-state';
import { MemberClassStyles, memberDate, memberValue } from '../../components/class/structure/member-class-views';

export function MemberStructureHomePage() {
  useClientCounselors();
  const read = useMixedHome();
  const model = adaptMixedHome(read.classes, read.counseling);
  const next = memberValue(model.next);
  const nextSeq = next && memberValue(next.seq);
  const nowMs = Date.now();
  const isOpen = next?.open === true;
  const agoLabel = isOpen && next ? startedAgoLabel(next.scheduledAt, nowMs) : null;
  const upcoming = model.upcoming.slice(0, 2);
  const classes = model.classes.status === 'success' ? model.classes.data.classes : [];
  const totalClassCount = model.classes.status === 'success' ? Math.max(classes.length, model.classes.data.total ?? classes.length) : 0;
  const counseling = model.counseling.status === 'success' ? model.counseling.data.relationships : [];
  const counselingEnabled = isCounselingEnabled();
  const name = useAuthStore((state) => state.user?.name);
  return <StructureShell role="member" title={`안녕하세요, ${name ?? '내담자'}님`} rightSlot={<CodeEntryButton />}><MemberClassStyles /><div className="mc-stack mh-home">
    <section className="sh-scope sh-hero" data-testid="class-hero" aria-label="다음 일정" data-area={next?.area}>
      {next && <div className="sh-hero__bg" style={{ backgroundImage: `url(${heroBackdrop(next.sessionId)})` }} aria-hidden="true" />}
      <div className="sh-hero__in">
      <div className="sh-hero__row">{isOpen ? <span className="sh-hchip live">지금 입장 가능</span> : <span className="sh-hchip">{model.nextIsComplete ? '다음 일정' : '확인된 다음 일정'}</span>}{next?.instant && <span className="sh-hchip">즉석 클래스</span>}{next && <span className="sh-hchip" aria-label="일정 영역">{next.area === 'meditation' ? '명상' : '상담'}</span>}</div>
      {next ? <><h2 className="sh-hero__title">{next.area === 'meditation' ? <><ReadField value={memberValue(next.title)} />{next.instant ? null : <> · <ReadField value={nextSeq == null ? undefined : `${nextSeq}회차`} /></>}</> : <ReadField value={nextSeq == null ? undefined : `상담 ${nextSeq}회차`} />}</h2>
        <div className="sh-hbox"><div className="sh-hbox__tx"><b>{next.area === 'meditation' ? '지도사' : '상담사'} · <ReadField value={memberValue(next.hostName)} /></b><span>{agoLabel ?? <ReadField value={memberDate(displayField(next.scheduledAt))} />}</span></div></div>
        <Link className="sh-hcta" to={`/class/${encodeURIComponent(next.sessionId)}/enter`}>입장하기</Link></>
        : <h2 className="sh-hero__title">{model.nextIsComplete ? '예정된 일정이 없어요' : read.classes.status === 'loading' || read.counseling.status === 'loading' ? '일정을 확인하고 있어요' : '확인된 예정 일정이 없어요'}</h2>}
      </div>
    </section>
    {upcoming.length > 0 && <section className="mh-upcoming" data-testid="home-upcoming" aria-label="이어서 예정된 일정"><h2 className="mh-upcoming__title">이어서 예정된 일정 {model.upcoming.length}건</h2>
      {upcoming.map((item) => <Link key={item.sessionId} className="mh-upcoming__row" to={item.area === 'meditation' ? `/app/classes/${encodeURIComponent(item.parentId)}` : counselingPath('member', item.parentId as RelationshipId)}><span><b><ReadField value={memberValue(item.title)} /></b><small><ReadField value={memberDate(displayField(item.scheduledAt))} /></small></span><em>보기</em></Link>)}
      {model.upcoming.length > upcoming.length && <Link className="mh-upcoming__more" to="/app/classes">전체 클래스 보기</Link>}
    </section>}
    <ClientHomePage hideHero classSections={<>
    <section className="mh-classes" aria-label="내 클래스" data-area="meditation"><div className="mc-row"><h2 className="mc-heading">내 클래스</h2><Link className="mc-link" to="/app/classes">전체 보기{totalClassCount > HOME_CLASS_LIMIT ? ` (${totalClassCount})` : ''}</Link></div>
      <ReadStateView status={model.classes.status === 'success' && classes.length === 0 ? 'empty' : model.classes.status} backTo="/app/classes" onRetry={read.retry}>
        <MemberClassStrip classes={classes.slice(0, HOME_CLASS_LIMIT)} />
      </ReadStateView>
    </section>
    {counselingEnabled && <section className="mh-counseling" aria-label="내 상담" data-area="counseling"><div className="mc-row"><h2 className="mc-heading">내 상담</h2><Link className="mc-link" to="/app/counseling">전체 보기</Link></div>
      <ReadStateView area="counseling" status={model.counseling.status === 'success' && counseling.length === 0 ? 'empty' : model.counseling.status} backTo="/app/counseling" onRetry={read.retry}>
        <div className="mc-grid">{counseling.map((item) => <article className="mc-card" key={item.id}><Link className="mc-card-link" to={counselingPath('member', item.id)}><h3>상담 일정</h3><p className="mc-muted">상담사 · <ReadField value={memberValue(item.counselorName)} /></p><p className="mc-muted">다음 상담 · <ReadField value={item.nextSession.kind === 'value' ? memberDate(item.nextSession.value.scheduledAt) : undefined} /></p></Link></article>)}</div>
      </ReadStateView>
    </section>}
    </>} />
  </div></StructureShell>;
}
