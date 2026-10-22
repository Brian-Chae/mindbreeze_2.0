// SDD-232 — 상담사 홈 히어로. 회원 홈과 같은 .sh-hero 표현. 홈에서 열기·시작은 하지 않고 회차 상세로만 보낸다.
import { Link } from 'react-router-dom';
import { heroBackdrop } from '../class/flow/shell/shell-data';
import { sessionStatusLabel } from '../../lib/session-status';
import type { ClassSummary } from '../../lib/api/dashboard';
import '../class/flow/shell/shell-kit.css';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export interface CounselorHomeHeroProps {
  session: ClassSummary | null;
  live: boolean;
  detailPath: string;
}

export function CounselorHomeHero({ session, live, detailPath }: CounselorHomeHeroProps) {
  const area = session?.area === 'counseling' ? '상담' : session?.area === 'meditation' ? '명상' : null;
  return (
    <section className="sh-scope sh-hero ch-hero" data-testid="counselor-home-hero" aria-label="다음 회차">
      {session && <div className="sh-hero__bg" style={{ backgroundImage: `url(${heroBackdrop(session.id)})` }} aria-hidden="true" />}
      <div className="sh-hero__in">
        <div className="sh-hero__row">
          <span className={`sh-hchip${live ? ' live' : ''}`}>{session ? (live ? sessionStatusLabel(session.status) : '다음 회차') : '다음 회차'}</span>
          {area && <span className="sh-hchip" aria-label="일정 영역">{area}</span>}
        </div>
        {session ? (
          <>
            <h2 className="sh-hero__title ch-hero__title">
              {session.title?.trim() || '이름 없는 회차'}{session.seq != null ? ` · ${session.seq}회차` : ''}
            </h2>
            <div className="sh-hbox"><div className="sh-hbox__tx">
              {session.scheduled_at && <b>{formatWhen(session.scheduled_at)}</b>}
              <span>참여 {session.participant_count}명</span>
            </div></div>
            <Link className="sh-hcta ch-hero__cta" to={detailPath}>회차 상세 보기</Link>
          </>
        ) : (
          <>
            <h2 className="sh-hero__title ch-hero__title">예정된 회차가 없어요</h2>
            <p className="ch-hero__sub">클래스를 바로 열어 회원과 함께 시작할 수 있어요.</p>
            <Link className="sh-hcta ch-hero__cta" to="/classes/now">지금 바로 시작</Link>
          </>
        )}
      </div>
    </section>
  );
}
