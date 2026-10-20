// SDD-209 H6 — FH06a 로비 시트 5종: 회원 초대 · 대기실 BGM · 내 LINK BAND · 발언권 · 채팅. 뷰는 props 만 받는다.
// 초대 시트에서만 4자리 입장 코드를 보이고 복사한다(QR 없음). 재발송은 요청 결과만 보여 준다(P7).
import type { ReactNode } from 'react';
import { AlertTriangle, Battery, Bell, Check, CheckCircle2, Copy, Hand, Key, MessageCircle, Mic, Music, Pause, Play, RefreshCw, Send, User, UserPlus, Users, Volume1, Volume2, Waves, XCircle } from 'lucide-react';
import type { LeadOffStatus } from '../../../../lib/eeg/types/eeg';
import { LOBBY_SHEET_TITLE, type LobbySheetKind } from '../../../../lib/class/flow/host-lobby-model';
import { isRemindRetryable, remindStatusText, remindTargets, type AwayRow } from '../../../../lib/class/flow/host-invite-remind';
import { ElectrodeLeds } from '../shared/ElectrodeLeds';
import { FlowButton, FlowChip, FlowNote, FlowSheet } from '../shared/flow-primitives';

function Row({ icon, title, sub, trail, strong, ok, warn }: { icon: ReactNode; title: string; sub?: string; trail?: ReactNode; strong?: boolean; ok?: boolean; warn?: boolean }) {
  return (
    <div className={strong ? 'fhb-row strong' : 'fhb-row'}>
      <span className={ok ? 'fhb-ico ok' : warn ? 'fhb-ico warn' : 'fhb-ico'}>{icon}</span>
      <div className="fhb-rt">
        <b>{title}</b>
        {sub ? <span className={warn ? 'warn' : undefined}>{sub}</span> : null}
      </div>
      {trail}
    </div>
  );
}

function Empty({ icon, title, sub, ok }: { icon: ReactNode; title: string; sub: string; ok?: boolean }) {
  return (
    <div className="fhb-empty">
      <span className={ok ? 'fhb-ico lg ok' : 'fhb-ico lg'}>{icon}</span>
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  );
}

// ───────── 회원 초대 ─────────

export interface InviteSheetProps {
  invited: number;
  inRoom: number;
  away: readonly AwayRow[];
  /** 4자리 입장 코드(없으면 코드 행을 숨긴다) */
  code: string | null;
  codeCopied?: boolean;
  /** 재발송 요청 중 */
  reminding?: boolean;
  onCopyCode: () => void;
  onRemind: (participantIds: string[]) => void;
  canInvite?: boolean;
  onInviteAdd: () => void;
}

export function InviteSheetBody({ invited, inRoom, away, code, codeCopied = false, reminding = false, canInvite = true, onCopyCode, onRemind, onInviteAdd }: InviteSheetProps) {
  const allIn = away.length === 0;
  const targets = remindTargets(away);
  return (
    <>
      <Row
        ok={allIn}
        icon={<Users size={20} aria-hidden="true" />}
        title={`초대 ${invited}명 · 대기실 ${inRoom}명`}
        sub={allIn ? (invited ? '모두 입장했어요' : '아직 초대한 회원이 없어요') : `${away.length}명이 아직 입장하지 않았어요`}
      />
      {allIn ? (
        invited ? <Empty ok icon={<CheckCircle2 size={24} aria-hidden="true" />} title="초대한 회원이 모두 입장했어요" sub="다시 알릴 회원이 없어요" /> : null
      ) : (
        <>
          <span className="fl-label">아직 입장하지 않은 회원 {away.length}명</span>
          <div className="fhb-msgs">
            {away.map((row) => (
              <Row
                key={row.id}
                warn={isRemindRetryable(row.status)}
                icon={<User size={20} aria-hidden="true" />}
                title={row.name}
                sub={remindStatusText(row.status)}
                trail={isRemindRetryable(row.status) ? (
                  <FlowButton kind="soft" disabled={reminding} onClick={() => onRemind([row.id])}><RefreshCw size={20} aria-hidden="true" />재시도</FlowButton>
                ) : undefined}
              />
            ))}
          </div>
        </>
      )}
      {code ? (
        <Row
          icon={<Key size={20} aria-hidden="true" />}
          title={`입장 코드 ${code}`}
          sub="참가자에게 직접 알려 주세요"
          trail={
            <button type="button" className="fl-iconbtn fhb-iconbtn" aria-label="입장 코드 복사" onClick={onCopyCode}>
              {codeCopied ? <Check size={20} aria-hidden="true" /> : <Copy size={20} aria-hidden="true" />}
            </button>
          }
        />
      ) : null}
      <div className="fhb-act">
        <FlowButton kind="primary" disabled={targets.length === 0 || reminding} onClick={() => onRemind(targets)}>
          <Bell size={20} aria-hidden="true" />{targets.length === 0 ? '다시 알릴 회원이 없어요' : `${targets.length}명에게 다시 알림`}
        </FlowButton>
        {canInvite && <FlowButton kind="soft" onClick={onInviteAdd}><UserPlus size={20} aria-hidden="true" />초대 추가</FlowButton>}
      </div>
    </>
  );
}

// ───────── BGM ─────────

export interface BgmTrack {
  id: string;
  title: string;
}

export interface BgmSheetProps {
  tracks: readonly BgmTrack[];
  selectedId: string | null;
  playing: boolean;
  /** 0~1 */
  progress: number;
  /** `01:20 / 03:40` */
  timeText: string;
  /** 0~1 */
  volume: number;
  onSelect: (id: string) => void;
  onTogglePlay: () => void;
  onVolume: (value: number) => void;
}

export function BgmSheetBody({ tracks, selectedId, playing, progress, timeText, volume, onSelect, onTogglePlay, onVolume }: BgmSheetProps) {
  return (
    <>
      <div className="fhb-msgs">
        {tracks.map((track) => {
          const on = track.id === selectedId;
          return (
            <button type="button" key={track.id} className="fhb-row fhb-track" aria-pressed={on} onClick={() => onSelect(track.id)}>
              <span className={on ? 'fhb-ico ok' : 'fhb-ico'}><Music size={20} aria-hidden="true" /></span>
              <div className="fhb-rt"><b>{track.title}</b></div>
              {on ? <CheckCircle2 size={20} className="fhb-ok" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="fhb-row strong">
        <button type="button" className="fl-iconbtn fhb-iconbtn" aria-label={playing ? '일시정지' : '재생'} onClick={onTogglePlay}>
          {playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
        </button>
        <div className="fhb-rt">
          <div className="fhb-bar" role="progressbar" aria-label="재생 위치" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} style={{ ['--p' as string]: `${Math.round(progress * 100)}%` }}><i /></div>
          <span style={{ marginTop: 8 }}>{timeText}</span>
        </div>
      </div>
      <div className="fhb-row">
        <span className="fhb-mid"><Volume1 size={20} aria-hidden="true" /></span>
        <input
          type="range"
          className="fhb-range"
          aria-label="모니터 볼륨"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(e) => onVolume(Number(e.target.value) / 100)}
        />
        <span className="fhb-mid"><Volume2 size={20} aria-hidden="true" /></span>
      </div>
      <FlowNote>대기실에서 회원에게도 같은 음악이 들려요. 시작하면 자동으로 줄어들어요.</FlowNote>
    </>
  );
}

// ───────── 내 밴드 ─────────

export interface BandSheetProps {
  connected: boolean;
  /** 접촉(LeadOff). 연결 전이거나 알 수 없으면 null */
  leadOff: LeadOffStatus | null;
  batteryText?: string | null;
  connecting?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function contactMessage(leadOff: LeadOffStatus): string {
  if (leadOff.ch1 && leadOff.ch2) return 'L·R 전극이 모두 이마에 닿지 않아요.';
  return `${leadOff.ch1 ? 'L' : 'R'} 전극이 이마에 닿지 않아요.`;
}

export function BandSheetBody({ connected, leadOff, batteryText = '충분해요', connecting = false, onConnect, onDisconnect }: BandSheetProps) {
  if (!connected) {
    return (
      <>
        <div className="fhb-ctr">
          <span className="fhb-ico lg"><Waves size={24} aria-hidden="true" /></span>
          <FlowChip tone="neutral" icon={<XCircle size={16} />}>연결 안 됨</FlowChip>
          <p>내 뇌파를 함께 볼 때만 이마에 착용해 연결해요. 연결하지 않아도 클래스를 진행할 수 있어요.</p>
        </div>
        <div className="fhb-act">
          <FlowButton kind="primary" disabled={connecting} onClick={onConnect}><Waves size={20} aria-hidden="true" />{connecting ? '연결하는 중이에요' : 'LINK BAND 연결'}</FlowButton>
        </div>
      </>
    );
  }
  const bad = !!leadOff && (leadOff.ch1 || leadOff.ch2);
  if (bad && leadOff) {
    return (
      <>
        <div className="fhb-ctr">
          <FlowChip tone="warn" icon={<AlertTriangle size={16} />}>접촉 불량</FlowChip>
          <h2>LINK BAND 위치를 조정해 주세요</h2>
          <p>{contactMessage(leadOff)} 빨간색 전극이 밀착되도록 밴드 크기를 내 머리에 맞춰 주세요.</p>
        </div>
        <div className="fl-card fhb-trk" data-pz="flow-card" data-size="sm">
          <ElectrodeLeds leadOff={leadOff} />
        </div>
        <div className="fhb-how">
          <div><span className="fhb-num">1</span>밴드를 이마 중앙에 맞춰 전극이 피부에 밀착되도록 조여 주세요.</div>
          <div><span className="fhb-num">2</span>머리카락이나 땀이 센서를 가리지 않게 정리한 뒤 다시 착용해 주세요.</div>
          <div><span className="fhb-num">3</span>밀착되면 수치가 다시 표시돼요. 안 되면 벗었다가 다시 착용해 주세요.</div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="fhb-ctr">
        <span className="fhb-ico lg ok"><Waves size={24} aria-hidden="true" /></span>
        <FlowChip tone="ok" icon={<CheckCircle2 size={16} />}>연결됨</FlowChip>
      </div>
      {batteryText ? <Row icon={<Battery size={20} aria-hidden="true" />} title="배터리" sub={batteryText} trail={<FlowChip tone="ok" icon={<CheckCircle2 size={16} />}>좋음</FlowChip>} /> : null}
      <Row icon={<CheckCircle2 size={20} aria-hidden="true" />} title="전극 접촉" sub="이마에 잘 닿아 있어요" trail={<FlowChip tone="ok" icon={<CheckCircle2 size={16} />}>접촉 양호</FlowChip>} />
      <div className="fhb-act">
        <FlowButton kind="soft" onClick={onDisconnect}><XCircle size={20} aria-hidden="true" />연결 해제</FlowButton>
      </div>
    </>
  );
}

// ───────── 발언권 ─────────

export interface SpeakPerson {
  id: string;
  name: string;
}

export interface SpeakSheetProps {
  raised: readonly SpeakPerson[];
  speaking: readonly SpeakPerson[];
  busyId?: string | null;
  onAllow: (id: string) => void;
  onStop: (id: string) => void;
}

export function SpeakSheetBody({ raised, speaking, busyId = null, onAllow, onStop }: SpeakSheetProps) {
  return (
    <>
      <span className="fl-label">손든 회원 {raised.length}명</span>
      {raised.length ? (
        <div className="fhb-msgs">
          {raised.map((p) => (
            <Row key={p.id} icon={<Hand size={20} aria-hidden="true" />} title={p.name} sub="손들었어요" trail={<FlowButton kind="soft" disabled={busyId === p.id} onClick={() => onAllow(p.id)}>발언 허용</FlowButton>} />
          ))}
        </div>
      ) : (
        <FlowNote>손든 회원이 없어요.</FlowNote>
      )}
      <span className="fl-label">발언 중 {speaking.length}명</span>
      {speaking.length ? (
        speaking.map((p) => (
          <Row key={p.id} strong ok icon={<Mic size={20} aria-hidden="true" />} title={p.name} sub="마이크가 켜져 있어요" trail={<FlowButton kind="soft" disabled={busyId === p.id} onClick={() => onStop(p.id)}>발언 마치기</FlowButton>} />
        ))
      ) : (
        <FlowNote>발언 중인 회원이 없어요.</FlowNote>
      )}
      <FlowNote>발언을 허용하면 그 회원의 마이크가 켜져요.</FlowNote>
    </>
  );
}

// ───────── 채팅 ─────────

export interface LobbyChatMessage {
  id: string;
  from: string;
  text: string;
  mine?: boolean;
}

export interface ChatSheetProps {
  enabled: boolean;
  /** 실제 채팅방(ChatRoom)을 시트 안에 넣을 때. 있으면 messages/입력줄 대신 이 노드를 보인다 */
  node?: ReactNode;
  messages: readonly LobbyChatMessage[];
  busy?: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onToggle: () => void;
  onSend: () => void;
}

export function ChatSheetBody({ enabled, node, messages, busy = false, draft, onDraft, onToggle, onSend }: ChatSheetProps) {
  const toggleRow = (
    <Row
      ok={enabled}
      icon={<MessageCircle size={20} aria-hidden="true" />}
      title="회원 채팅"
      sub={enabled ? '켜짐' : '꺼짐'}
      trail={<button type="button" className={enabled ? 'fhb-sw on' : 'fhb-sw'} role="switch" aria-checked={enabled} aria-label="회원 채팅" disabled={busy} onClick={onToggle} />}
    />
  );
  if (node !== undefined) {
    return (
      <>
        {toggleRow}
        {enabled ? node : <Empty icon={<MessageCircle size={24} aria-hidden="true" />} title="채팅이 꺼져 있어요" sub="켜면 회원이 대기실에서도 메시지를 보낼 수 있어요" />}
      </>
    );
  }
  return (
    <>
      <Row
        ok={enabled}
        icon={<MessageCircle size={20} aria-hidden="true" />}
        title="회원 채팅"
        sub={enabled ? '켜짐' : '꺼짐'}
        trail={<button type="button" className={enabled ? 'fhb-sw on' : 'fhb-sw'} role="switch" aria-checked={enabled} aria-label="회원 채팅" disabled={busy} onClick={onToggle} />}
      />
      {enabled ? (
        <div className="fhb-msgs">
          {messages.map((m) => (
            <div key={m.id} className={m.mine ? 'fhb-bubble me' : 'fhb-bubble'}><small>{m.from}</small>{m.text}</div>
          ))}
        </div>
      ) : (
        <Empty icon={<MessageCircle size={24} aria-hidden="true" />} title="채팅이 꺼져 있어요" sub="켜면 회원이 대기실에서도 메시지를 보낼 수 있어요" />
      )}
      <div className="fhb-row strong">
        <input
          className="fhb-chatin"
          value={draft}
          disabled={!enabled}
          placeholder={enabled ? '메시지를 입력해요' : '채팅을 켜면 보낼 수 있어요'}
          aria-label="메시지"
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && enabled) onSend(); }}
        />
        <button type="button" className="fl-iconbtn fhb-iconbtn" aria-label="보내기" disabled={!enabled || !draft.trim()} onClick={onSend}><Send size={20} aria-hidden="true" /></button>
      </div>
    </>
  );
}

// ───────── 시트 묶음 ─────────

export interface LobbySheetsProps {
  kind: LobbySheetKind | null;
  onClose: () => void;
  invite: InviteSheetProps;
  bgm: BgmSheetProps;
  band: BandSheetProps;
  speak: SpeakSheetProps;
  chat: ChatSheetProps;
}

/** 열려 있는 시트 하나만 렌더한다(한 번에 하나) */
export function LobbySheets({ kind, onClose, invite, bgm, band, speak, chat }: LobbySheetsProps) {
  const body = (): ReactNode => {
    switch (kind) {
      case 'invite':
        return <InviteSheetBody {...invite} />;
      case 'bgm':
        return <BgmSheetBody {...bgm} />;
      case 'band':
        return <BandSheetBody {...band} />;
      case 'speak':
        return <SpeakSheetBody {...speak} />;
      case 'chat':
        return <ChatSheetBody {...chat} />;
      default:
        return null;
    }
  };
  return (
    <FlowSheet open={kind !== null} title={kind ? LOBBY_SHEET_TITLE[kind] : ''} onClose={onClose}>
      {body()}
    </FlowSheet>
  );
}
