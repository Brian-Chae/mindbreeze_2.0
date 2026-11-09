// SDD-318/320 — 회원 홈(D안). 11/9 대표 지시: 레이아웃·컴포넌트 구조와 내용은 운영 웹 회원 홈과 동일하게.
// 운영 홈(member-structure-home-page)과 같은 순서·같은 컴포넌트를 쓰고, 셸·다음 일정 카드(자연 배경)만 새 디자인을 쓴다.
//   다음 일정 → 코드로 입장 → 이어서 예정된 일정 → 요약 타일 4 → 내 클래스 → 내 상담 → 담당 코치
//   → (좌) 초대된 클래스 · 이번 주 클래스 · 내 리포트 | (우) 최근 대화 · 새 알림
import { heroBackdrop } from '../../../components/class/flow/shell/shell-data';
import { Link } from 'react-router-dom';
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import { UiV2ArcRing } from '../../../components/ui-v2/ui-v2-arc-ring';
import { UiV2ToolbarCode } from '../../../components/ui-v2/ui-v2-toolbar-code';
import { CounselorSection } from '../../../components/client/counselor-section';
import { CodeEntryButton } from '../../../components/client/code-entry-button';
import { MemberClassStrip } from '../../../components/client/home/member-class-strip';
import { MemberClassStyles, memberDate, memberValue } from '../../../components/class/structure/member-class-views';
import { ReadField, ReadStateView } from '../../../components/class/structure/read-state';
import '../../../components/class/structure/structure-shell.css';
import '../../../components/client/home/member-home-layout.css';
import '../../../components/client/home/home-card-parity.css';
import '../../../components/class/flow/shell/shell-kit.css';
import ClientHomePage from '../ClientHomePage';
import { useClientCounselors } from '../../../hooks/use-client-counselors';
import { useMixedHome } from '../../../hooks/use-class-structure';
import { adaptMixedHome } from '../../../lib/class-structure/adapters';
import { counselingPath } from '../../../lib/class-structure/navigation';
import type { RelationshipId } from '../../../lib/class-structure/read-model';
import { displayField } from '../../../lib/class-structure/read-model';
import { startedAgoLabel } from '../../../lib/class-structure/home-next';
import { HOME_CLASS_LIMIT } from '../../../lib/dashboard/counselor-home-model';
import { isCounselingEnabled } from '../../../lib/feature-flags';
import { useAuthStore } from '../../../stores/authStore';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

function parts(iso: string | undefined) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, day: d.getDate(), month: `${d.getMonth() + 1}월`, weekday: WEEKDAYS[d.getDay()] };
}

export function UiV2HomePage() {
  useClientCounselors();
  const read = useMixedHome();
  const model = adaptMixedHome(read.classes, read.counseling);
  const name = useAuthStore((s) => s.user?.name);
  const next = memberValue(model.next);
  const nextTime = parts(next?.scheduledAt);
  const nextSeq = next ? memberValue(next.seq) : undefined;
  const isOpen = next?.open === true;
  const agoLabel = isOpen && next ? startedAgoLabel(next.scheduledAt, Date.now()) : null;
  const upcoming = model.upcoming.slice(0, 2);
  const classes = model.classes.status === 'success' ? model.classes.data.classes : [];
  const totalClassCount = model.classes.status === 'success' ? Math.max(classes.length, model.classes.data.total ?? classes.length) : 0;
  const counseling = model.counseling.status === 'success' ? model.counseling.data.relationships : [];
  const counselingEnabled = isCounselingEnabled();
  const loading = read.classes.status === 'loading' || read.counseling.status === 'loading';
  const heroHref = next ? (isOpen ? `/class/${encodeURIComponent(next.sessionId)}/enter` : next.area === 'meditation' ? `/app/classes/${encodeURIComponent(next.parentId)}` : counselingPath('member', next.parentId as RelationshipId)) : '/app/classes';

  return (
    <UiV2ClientShell toolbarExtra={<UiV2ToolbarCode />} title="나에게 돌아오는 시간" subtitle={`${name ?? '내담자'}님, 오늘의 클래스와 기록을 만나보세요.`}>
      <div className="cs-structure u2-member-home"><MemberClassStyles /><div className="mc-stack mh-home">
        {/* 다음 일정 — 운영과 같은 내용(입장 가능/다음 일정·즉석·영역·회차·지도사·시각), 표현만 자연 배경 */}
        <section className="u2-card u2-hero u2-hero--nature" data-testid="class-hero" aria-label="다음 일정" data-area={next?.area} style={{ backgroundImage: `linear-gradient(160deg,rgba(37,16,56,.35),rgba(37,16,56,.72) 55%,rgba(37,16,56,.92)),url(${heroBackdrop(next?.sessionId ?? 'home')})` }}>
          <UiV2ArcRing variant="hero" />
          <span className="u2-eyebrow">{isOpen ? '지금 입장 가능' : model.nextIsComplete ? '다음 일정' : '확인된 다음 일정'}{next?.instant ? ' · 즉석 클래스' : ''}{next ? ` · ${next.area === 'meditation' ? '명상' : '상담'}` : ''}</span>
          {next ? <>
            {nextTime && <><div className="u2-num">{nextTime.time}</div><small>{nextTime.month} {nextTime.day}일 {nextTime.weekday}요일</small></>}
            <h2>{next.area === 'meditation' ? <><ReadField value={memberValue(next.title)} />{next.instant ? null : <> · <ReadField value={nextSeq == null ? undefined : `${nextSeq}회차`} /></>}</> : <ReadField value={nextSeq == null ? undefined : `상담 ${nextSeq}회차`} />}</h2>
            <p className="u2-muted">{next.area === 'meditation' ? '지도사' : '코치'} · <ReadField value={memberValue(next.hostName)} />{agoLabel ? ` · ${agoLabel}` : ''}</p>
            <Link className="u2-primary" to={heroHref}>{isOpen ? '입장하기' : '클래스 보기'}<span aria-hidden="true" style={{ marginLeft: 'auto' }}>↗</span></Link>
          </> : <h2 className="u2-gap">{model.nextIsComplete ? '예정된 일정이 없어요' : loading ? '일정을 확인하고 있어요' : '확인된 예정 일정이 없어요'}</h2>}
        </section>
        <CodeEntryButton placement="body" />
        {upcoming.length > 0 && <section className="mh-upcoming" data-testid="home-upcoming" aria-label="이어서 예정된 일정"><h2 className="mh-upcoming__title">이어서 예정된 일정 {model.upcoming.length}건</h2>
          {upcoming.map((item) => <Link key={item.sessionId} className="mh-upcoming__row" to={item.area === 'meditation' ? `/app/classes/${encodeURIComponent(item.parentId)}` : counselingPath('member', item.parentId as RelationshipId)}><span><b><ReadField value={memberValue(item.title)} /></b><small><ReadField value={memberDate(displayField(item.scheduledAt))} /></small></span><em>보기</em></Link>)}
          {model.upcoming.length > upcoming.length && <Link className="mh-upcoming__more" to="/app/classes">전체 클래스 보기</Link>}
        </section>}
        {/* 요약 타일·초대된 클래스·이번 주 클래스·내 리포트·최근 대화·새 알림은 운영 홈 컴포넌트 그대로 */}
        <ClientHomePage hideHero classSections={<>
          <section className="mh-classes" aria-label="내 클래스" data-area="meditation"><div className="mc-row"><h2 className="mc-heading">내 클래스</h2><Link className="mc-link" to="/app/classes">전체 보기{totalClassCount > HOME_CLASS_LIMIT ? ` (${totalClassCount})` : ''}</Link></div>
            <ReadStateView status={model.classes.status === 'success' && classes.length === 0 ? 'empty' : model.classes.status} backTo="/app/classes" onRetry={read.retry}>
              <MemberClassStrip classes={classes.slice(0, HOME_CLASS_LIMIT)} />
            </ReadStateView>
          </section>
          {counselingEnabled && <section className="mh-counseling" aria-label="내 상담" data-area="counseling"><div className="mc-row"><h2 className="mc-heading">내 상담</h2><Link className="mc-link" to="/app/counseling">전체 보기</Link></div>
            <ReadStateView area="counseling" status={model.counseling.status === 'success' && counseling.length === 0 ? 'empty' : model.counseling.status} backTo="/app/counseling" onRetry={read.retry}>
              <div className="mc-grid">{counseling.map((item) => <article className="mc-card" key={item.id}><Link className="mc-card-link" to={counselingPath('member', item.id)}><h3>상담 일정</h3><p className="mc-muted">코치 · <ReadField value={memberValue(item.counselorName)} /></p><p className="mc-muted">다음 상담 · <ReadField value={item.nextSession.kind === 'value' ? memberDate(item.nextSession.value.scheduledAt) : undefined} /></p></Link></article>)}</div>
            </ReadStateView>
          </section>}
          <CounselorSection />
        </>} />
      </div></div>
    </UiV2ClientShell>
  );
}
