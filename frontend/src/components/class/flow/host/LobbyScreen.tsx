// SDD-209 H5 — FH06 로비(클래스 열림): 초대 현황 + 대기 회원 준비 현황 + 도크 + 시작하기(항상 활성).
// 입장은 4자리 코드로 하며 초대 명단은 현황 표시용이다(P5). 코드는 이 본문에 두지 않고 `회원 초대` 시트에서만 보인다.
import type { ReactNode } from 'react';
import { AlertTriangle, Bell, CheckCircle2, ChevronLeft, Clock, MapPin, Hand, MessageCircle, MinusCircle, Music, Play, UserPlus, Users, Waves } from 'lucide-react';
import { BAND_LABEL } from '../../../../lib/class/class-wizard';
import {
  LOBBY_CELL_WORD, badElectrodeWord, inviteStatusLine, lobbyDockItems, lobbyEmptyHint, lobbyStatusLine, lobbySubtitle,
  type LobbyCell, type LobbyContext, type LobbyDockKind, type LobbyModel, type LobbyRow,
} from '../../../../lib/class/flow/host-lobby-model';
import type { ElectrodeState } from '../../../../lib/class/band-step';
import { FlowButton, FlowCard, FlowChip } from '../shared/flow-primitives';
import { HostFlowFrame } from './HostFlowFrame';

export interface LobbyScreenProps extends LobbyContext {
  title: string;
  /** 오프라인 장소 줄 */
  address: string | null;
  startText: string;
  model: LobbyModel;
  starting?: boolean;
  backdropSrc?: string;
  sheet?: ReactNode;
  sheetOpen?: boolean;
  /** 네트워크 끊김 등 겹침 배너 */
  banner?: ReactNode;
  onBack: () => void;
  onStart: () => void;
  onRemind: () => void;
  onInviteAdd: () => void;
  onInviteSheet: () => void;
  onDock: (kind: LobbyDockKind) => void;
}

const DOCK_ICON: Readonly<Record<LobbyDockKind, typeof Music>> = { bgm: Music, band: Waves, speak: Hand, chat: MessageCircle };

function CellIcon({ cell }: { cell: Exclude<LobbyCell, 'na'> }) {
  if (cell === 'ok') return <CheckCircle2 size={16} aria-hidden="true" />;
  if (cell === 'wait') return <Clock size={16} aria-hidden="true" />;
  if (cell === 'skip') return <MinusCircle size={16} aria-hidden="true" />;
  return <AlertTriangle size={16} aria-hidden="true" />;
}

const ELECTRODE_WORD: Readonly<Record<ElectrodeState, string>> = { good: '양호', bad: '실패', unknown: '미확인' };

/** 접촉 불량 행의 전극 LED 3개(색 + 라벨, 체크·엑스 아이콘 없음) */
function LeadRow({ row }: { row: LobbyRow }) {
  const e = row.electrodes;
  if (!e) return null;
  const items: ReadonlyArray<readonly [string, ElectrodeState]> = [['왼쪽', e.left], ['기준', e.ref], ['오른쪽', e.right]];
  return (
    <div className="fhb-lead" data-pz="flow-lead-row">
      {items.map(([label, state]) => (
        <span className="fhb-lx" key={label}>
          <span className={state === 'good' ? 'fhb-led ok' : 'fhb-led bad'} aria-hidden="true" />
          <span>{label} {ELECTRODE_WORD[state]}</span>
        </span>
      ))}
    </div>
  );
}

function MemberRow({ row }: { row: LobbyRow }) {
  const cells: ReadonlyArray<readonly [string, LobbyCell]> = ([['설문', row.survey], ['밴드', row.band], ['기기', row.device]] as const).filter(([, c]) => c !== 'na');
  const aria = cells.map(([label, c]) => `${label} ${c === 'na' ? '' : LOBBY_CELL_WORD[c]}${c === 'bad' && row.electrodes ? `(${badElectrodeWord(row.electrodes)})` : ''}`).join(', ');
  return (
    <div className={row.band === 'bad' ? 'fhb-mrow bad' : 'fhb-mrow'} role="group" aria-label={`${row.name}: ${aria}`}>
      <span className="av">{row.name.slice(0, 1)}</span>
      <span className="nm">{row.name}</span>
      <div className="fhb-cells">
        {cells.map(([label, cell]) => cell === 'na' ? null : (
          <span key={label} className={`fhb-cell ${cell}`}><CellIcon cell={cell} />{label}</span>
        ))}
      </div>
      <LeadRow row={row} />
    </div>
  );
}

export function LobbyScreen(props: LobbyScreenProps) {
  const { title, place, size, band, address, startText, model, starting = false, backdropSrc, sheet = null, sheetOpen = false, banner } = props;
  const { stats, rows } = model;
  const offline = place === 'offline';
  const ctx: LobbyContext = { place, size, band };
  const dock = lobbyDockItems(ctx);
  return (
    <HostFlowFrame
      className="fh-lobby"
      place={place}
      backdropSrc={backdropSrc}
      left={{ label: '나가기', icon: <ChevronLeft size={24} />, onClick: props.onBack }}
      title={title}
      sub={lobbySubtitle(ctx)}
      sheet={sheet}
      sheetOpen={sheetOpen}
      banner={banner}
      foot={
        <>
          <p className={rows.length ? 'fhb-fnote' : 'fhb-fnote two'}>{lobbyStatusLine(stats)}</p>
          <FlowButton kind="primary" disabled={starting} onClick={props.onStart}><Play size={20} aria-hidden="true" />{starting ? '시작하는 중이에요' : '시작하기'}</FlowButton>
        </>
      }
    >
      <FlowCard size="sm">
        <div className="fhb-invite">
          <div className="l">
            <span className="fl-label">초대 현황</span>
            <span className="fhb-inv-n">초대 {stats.invited}명 · 대기실 {stats.inRoom}명</span>
            <span className="fhb-link">{inviteStatusLine(stats)}</span>
          </div>
          <div className="r">
            <FlowButton kind="soft" disabled={stats.away === 0} onClick={props.onRemind}><Bell size={20} aria-hidden="true" />다시 알림</FlowButton>
            <FlowButton kind="soft" onClick={props.onInviteAdd}><UserPlus size={20} aria-hidden="true" />초대 추가</FlowButton>
          </div>
        </div>
      </FlowCard>
      {offline ? (
        <div className="fhb-row strong fhb-venue">
          <span className="fhb-ico ok"><MapPin size={20} aria-hidden="true" /></span>
          <div className="fhb-rt"><b>{address?.trim() || '장소는 클래스 상세에서 확인해요'}</b><span>{startText} 시작 예정</span></div>
        </div>
      ) : null}
      <div className="fhb-listcard" data-pz="flow-list">
        <div className="fhb-lhead">
          <b>대기실 {stats.inRoom}명</b>
          <FlowChip icon={<Waves size={16} />}>{BAND_LABEL[band]}</FlowChip>
        </div>
        {rows.length ? (
          <div className={rows.length > 4 ? 'fhb-list two' : 'fhb-list'}>
            {rows.map((row) => <MemberRow key={row.id} row={row} />)}
          </div>
        ) : (
          <div className="fhb-empty">
            <span className="fhb-ico lg"><Users size={24} aria-hidden="true" /></span>
            <h2>아직 대기 중인 회원이 없어요</h2>
            <p>{lobbyEmptyHint(stats.invited, place)}</p>
          </div>
        )}
      </div>
      <div className="fhb-dock">
        {dock.map((item) => {
          const Icon = DOCK_ICON[item.kind];
          return (
            <button type="button" key={item.kind} className="fhb-dk" onClick={() => props.onDock(item.kind)}>
              <Icon size={24} aria-hidden="true" />{item.label}
            </button>
          );
        })}
      </div>
    </HostFlowFrame>
  );
}
