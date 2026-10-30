// SDD-208 M4 — 회원 전체 화면 상태: 네트워크 끊김 카드(M19) · 대기열(M20) · 수업 종료(M21).
// 카드는 화면 정중앙(가로·세로)에 한 덩어리로 놓는다(균형.md MS3). 종료 화면에는 점수·퍼센트 숫자를 두지 않는다(D5).
import { useState } from 'react';
import { CircleCheckBig, Clock, WifiOff } from 'lucide-react';
import { PlayerBackdrop } from '../shared/PlayerBackdrop';
import { PlayerSheet } from '../shared/PlayerSheet';
import { PlayerShell } from '../shared/PlayerShell';
import { MemberBrandMark } from './MemberBrandMark';
import type { MemberEndModel, MemberViewActions, MemberWaitlistModel } from './member-view-types';
import './member-player.css';

interface MemberNetDownCardProps {
  /** 서버로 아직 못 보낸 밴드 데이터 수 */
  pendingCount: number;
  onRetry: () => void;
  /** 기기 인터넷은 정상, 서버 연결만 끊김(앱 복귀 직후 등) — 밴드는 앱이 따로 유지한다 */
  serverOnly?: boolean;
}

/** M19 — 무대 안에 놓이는 끊김 안내. 링·추이·미디어 줄을 대신하고 도크는 남는다 */
export function MemberNetDownCard({ pendingCount, onRetry, serverOnly = false }: MemberNetDownCardProps) {
  return (
    <section className="mp-netdown" data-pz="net-down" aria-live="polite">
      <span className="mp-netdown__ic"><WifiOff size={28} strokeWidth={2} aria-hidden="true" /></span>
      <h3>{serverOnly ? '서버에 다시 연결하는 중이에요' : '연결이 끊겼어요'}</h3>
      <p>{serverOnly ? '밴드는 계속 연결돼 있어요. 잠시 후에도 안 되면 다시 연결을 눌러 주세요.' : '인터넷 연결을 확인하고 다시 시도해 주세요.'}</p>
      {pendingCount > 0 ? (
        <p className="mp-netdown__note">밴드로 측정한 데이터는 이 기기에 안전하게 보관 중이에요. 연결되면 이어서 기록돼요.</p>
      ) : null}
      <button type="button" className="mp-pill mp-pill--primary mp-pill--block" onClick={onRetry}>다시 연결</button>
    </section>
  );
}

interface FullSceneProps {
  backdropSrc?: string;
  sheet?: React.ReactNode;
  sheetOpen?: boolean;
  children: React.ReactNode;
}

/** 상단 바·도크 없이 카드 하나만 가운데에 두는 장면 */
function FullScene({ backdropSrc, sheet, sheetOpen = false, children }: FullSceneProps) {
  return (
    <PlayerShell
      place="online"
      sheetOpen={sheetOpen}
      backdrop={<PlayerBackdrop imageSrc={backdropSrc} />}
      top={null}
      dock={null}
      sheet={sheet ?? null}
    >
      <div className="mp-full-center">{children}</div>
    </PlayerShell>
  );
}

interface InfoRow {
  label: string;
  value: string;
}

function FullCard({ icon, ok, title, lead, rows, note, children }: {
  icon: React.ReactNode;
  ok?: boolean;
  title: string;
  lead: React.ReactNode;
  rows: readonly InfoRow[];
  note?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="mp-fv-card" data-pz="fv-card" aria-labelledby="mp-fv-title">
      <MemberBrandMark className="mp-fv-logo" />
      <span className="mp-fv-ic" data-ok={ok ? 'true' : undefined}>{icon}</span>
      <h2 id="mp-fv-title">{title}</h2>
      <p>{lead}</p>
      <div className="mp-fv-info">
        {rows.map((row) => (
          <div key={row.label}><span>{row.label}</span><b>{row.value}</b></div>
        ))}
      </div>
      {note ? <p className="mp-fv-note">{note}</p> : null}
      {children}
    </section>
  );
}

interface MemberWaitlistViewProps {
  waitlist: MemberWaitlistModel;
  backdropSrc?: string;
  onLeave: MemberViewActions['onWaitlistLeave'];
}

/** M20 — 정원이 차서 대기 중. 자리가 나면 자동으로 입장한다 */
export function MemberWaitlistView({ waitlist, backdropSrc, onLeave }: MemberWaitlistViewProps) {
  const rows: InfoRow[] = [{ label: '수업', value: waitlist.title }];
  if (waitlist.counselorName) rows.push({ label: '코치', value: `${waitlist.counselorName} 코치` });
  if (waitlist.startLabel) rows.push({ label: '시작', value: waitlist.startLabel });
  return (
    <FullScene backdropSrc={backdropSrc}>
      <FullCard
        icon={<Clock size={28} strokeWidth={2} aria-hidden="true" />}
        title="대기 중이에요"
        lead={<>자리가 나면 자동으로 입장해요.<br />이 화면을 열어 둬 주세요.</>}
        rows={rows}
        note={waitlist.notifyByPush ? '입장 알림은 이 기기와 푸시로 보내 드려요.' : null}
      >
        <button type="button" className="mp-pill mp-pill--block" onClick={onLeave}>대기열에서 나가기</button>
      </FullCard>
    </FullScene>
  );
}

interface MemberEndViewProps {
  end: MemberEndModel;
  backdropSrc?: string;
  onAction: MemberViewActions['onEndAction'];
}

type EndSheet = 'report' | 'checkin';

/** M21 — 수업 종료. 점수·퍼센트는 보여 주지 않고, 리포트는 준비되면 메일로 간다 */
export function MemberEndView({ end, backdropSrc, onAction }: MemberEndViewProps) {
  const [sheet, setSheet] = useState<EndSheet | null>(null);
  const panel = sheet === 'report' ? end.reportPanel : sheet === 'checkin' ? end.checkinPanel : null;
  return (
    <FullScene
      backdropSrc={backdropSrc}
      sheetOpen={sheet !== null}
      sheet={
        <PlayerSheet open={sheet !== null} title={sheet === 'report' ? '리포트 받기' : '오늘 상태 남기기'} onClose={() => setSheet(null)}>
          {panel}
        </PlayerSheet>
      }
    >
      <FullCard
        ok
        icon={<CircleCheckBig size={28} strokeWidth={2} aria-hidden="true" />}
        title="수고하셨어요"
        lead="리포트는 준비되면 메일로 보내 드려요."
        rows={[
          { label: '수업', value: end.title },
          { label: '함께한 시간', value: end.durationLabel },
          { label: '리포트', value: '준비되면 메일 발송' },
        ]}
        note="AI 기록과 리포트를 만드는 데 몇 분 걸릴 수 있어요."
      >
        {end.reportPanel ? <button type="button" className="mp-pill mp-pill--block" onClick={() => setSheet('report')}>리포트 받기</button> : null}
        {end.checkinPanel ? <button type="button" className="mp-pill mp-pill--block" onClick={() => setSheet('checkin')}>오늘 상태 남기기</button> : null}
        <button type="button" className="mp-pill mp-pill--primary mp-pill--block" onClick={onAction}>{end.actionLabel}</button>
      </FullCard>
    </FullScene>
  );
}
