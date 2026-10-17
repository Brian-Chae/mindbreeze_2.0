// SDD-209 H5 — 상담사 로비(FH06) 행 모델. 순수 함수만 둔다.
// 규칙(plan §5.5): 초대 명단(live-metrics) 기준으로 인원을 세고, 대기실 presence(waiting_room_changed)를 덮어쓴다.
// presence 가 유실돼도 초대 N 은 줄지 않고, 그 사람은 `아직 입장하지 않았어요` 쪽으로 강등된다(행이 사라지지 않는다).
import type { LinkbandMode } from '../../api/session';
import type { LeadOffStatus } from '../../eeg/types/eeg';
import { deriveElectrodes, type Electrodes } from '../band-step';
import type { FlowPlace, FlowSize } from './types';

/** 초대 명단 한 명(live-metrics 행) */
export interface LobbyRosterEntry {
  participantId: string;
  name: string;
}

export interface LobbyReadinessInput {
  surveyDone: boolean;
  bandDone: boolean;
  deviceDone: boolean;
  /** 건너뛰기로 완료한 단계(BE-10 배포 후 전달, 없으면 완료로만 본다) */
  surveySkipped?: boolean;
  bandSkipped?: boolean;
  deviceSkipped?: boolean;
}

/** 대기실에 들어와 있는 사람(presence) */
export interface LobbyPresenceEntry {
  participantId: string;
  nickname: string | null;
  readiness?: LobbyReadinessInput | null;
  /** 전극 접촉(BE-10). 없으면 접촉 상태를 알 수 없다 */
  leadOff?: LeadOffStatus | null;
}

/** 단계 셀 상태: ok 완료 / wait 준비 중 / skip 건너뜀 / bad 접촉 불량 / na 해당 없음(숨김) */
export type LobbyCell = 'ok' | 'wait' | 'skip' | 'bad' | 'na';

export interface LobbyRow {
  id: string;
  name: string;
  survey: LobbyCell;
  band: LobbyCell;
  device: LobbyCell;
  /** 접촉 불량일 때만 채운다 */
  electrodes: Electrodes | null;
  ready: boolean;
}

export interface LobbyContext {
  place: FlowPlace;
  size: FlowSize;
  band: LinkbandMode;
}

export interface LobbyStats {
  /** 초대 N명 */
  invited: number;
  /** 대기실 M명 */
  inRoom: number;
  /** 아직 입장하지 않은 초대 인원 */
  away: number;
  ready: number;
  waiting: number;
}

export interface LobbyModel {
  rows: LobbyRow[];
  stats: LobbyStats;
  /** 아직 입장하지 않은 초대 명단 이름 */
  awayNames: string[];
  /** 아직 입장하지 않은 초대 명단(다시 알림 대상 id 포함) */
  awayEntries: LobbyRosterEntry[];
}

const READY_CELLS: ReadonlySet<LobbyCell> = new Set<LobbyCell>(['ok', 'skip', 'na']);

export function isCellDone(cell: LobbyCell): boolean {
  return READY_CELLS.has(cell);
}

function leadOffBad(leadOff: LeadOffStatus | null | undefined): boolean {
  return !!leadOff && (leadOff.ch1 || leadOff.ch2);
}

function stepCell(done: boolean, skipped: boolean | undefined): LobbyCell {
  if (!done) return 'wait';
  return skipped ? 'skip' : 'ok';
}

export function deriveLobbyRow(id: string, name: string, presence: LobbyPresenceEntry, ctx: LobbyContext): LobbyRow {
  const r = presence.readiness;
  const survey = stepCell(!!r?.surveyDone, r?.surveySkipped);
  let band: LobbyCell;
  if (ctx.band === 'none') band = 'na';
  else if (r?.bandDone && !r.bandSkipped && leadOffBad(presence.leadOff)) band = 'bad';
  else band = stepCell(!!r?.bandDone, r?.bandSkipped);
  const device: LobbyCell = ctx.place === 'offline' ? 'na' : stepCell(!!r?.deviceDone, r?.deviceSkipped);
  return {
    id,
    name,
    survey,
    band,
    device,
    electrodes: band === 'bad' ? deriveElectrodes(presence.leadOff ?? null) : null,
    ready: isCellDone(survey) && isCellDone(band) && isCellDone(device),
  };
}

/** 이름 정본: 초대 명단 → presence 닉네임 순 */
export function deriveLobby(roster: readonly LobbyRosterEntry[], presence: readonly LobbyPresenceEntry[], ctx: LobbyContext): LobbyModel {
  const nameById = new Map(roster.map((r) => [r.participantId, r.name]));
  const seen = new Set<string>();
  const rows: LobbyRow[] = [];
  for (const p of presence) {
    if (seen.has(p.participantId)) continue;
    seen.add(p.participantId);
    const name = nameById.get(p.participantId) ?? (p.nickname?.trim() || '참가자');
    rows.push(deriveLobbyRow(p.participantId, name, p, ctx));
  }
  const awayEntries = roster.filter((r) => !seen.has(r.participantId));
  const awayNames = awayEntries.map((r) => r.name);
  // 초대 명단에 없는 대기실 인원(예: 코드로 입장한 비회원)도 초대 N 보다 앞서지 않도록 N 을 보정한다
  const outsiders = rows.filter((row) => !nameById.has(row.id)).length;
  const invited = roster.length + outsiders;
  const ready = rows.filter((row) => row.ready).length;
  return {
    rows,
    awayNames,
    awayEntries,
    stats: { invited, inRoom: rows.length, away: awayNames.length, ready, waiting: rows.length - ready },
  };
}

/** 로비 상태줄. 대기실이 비어도 시작할 수 있다는 점을 알린다 */
export function lobbyStatusLine(stats: Pick<LobbyStats, 'inRoom' | 'ready' | 'waiting'>): string {
  if (stats.inRoom === 0) return '대기실이 비어 있어요 · 초대한 회원은 시작 후에도 입장할 수 있어요';
  if (stats.waiting > 0) return `${stats.ready}명 준비 완료 · ${stats.waiting}명 준비 중`;
  return stats.inRoom === 1 ? '회원이 준비 완료' : `${stats.inRoom}명 모두 준비 완료`;
}

/** 초대 카드의 한 줄(입장 현황) */
export function inviteStatusLine(stats: Pick<LobbyStats, 'invited' | 'away'>): string {
  if (stats.invited === 0) return '아직 초대한 회원이 없어요';
  if (stats.away > 0) return `${stats.away}명이 아직 입장하지 않았어요`;
  return '초대한 회원이 모두 입장했어요';
}

export function lobbyEmptyHint(invited: number, place: FlowPlace): string {
  if (invited === 0) return '초대 추가로 회원을 초대할 수 있어요';
  return place === 'offline' ? '초대한 회원이 도착해 입장하면 여기에 나타나요' : '초대한 회원이 입장하면 여기에 나타나요';
}

export type LobbyDockKind = 'bgm' | 'band' | 'speak' | 'chat';

export interface LobbyDockItem {
  kind: LobbyDockKind;
  label: string;
}

/** 로비 도크: 오프라인은 BGM·발언권 없음, 밴드 사용 안 함은 내 밴드 없음, 발언권은 온라인 그룹만 */
export function lobbyDockItems(ctx: LobbyContext): LobbyDockItem[] {
  const items: LobbyDockItem[] = [];
  if (ctx.place === 'online') items.push({ kind: 'bgm', label: 'BGM' });
  if (ctx.band !== 'none') items.push({ kind: 'band', label: '내 밴드' });
  if (ctx.place === 'online' && ctx.size === 'group') items.push({ kind: 'speak', label: '발언권' });
  items.push({ kind: 'chat', label: '채팅' });
  return items;
}

/** 시작하기는 항상 활성(F7) — 그룹 0명·준비 중 회원이 있어도 시작 후 입장할 수 있다 */
export function canStartLobby(): true {
  return true;
}

export function lobbySubtitle(ctx: Pick<LobbyContext, 'place' | 'size'>): string {
  return `로비 · ${ctx.place === 'online' ? '온라인' : '오프라인'} · ${ctx.size === 'group' ? '그룹' : '1:1'}`;
}

export const LOBBY_CELL_ICON_NAME: Readonly<Record<Exclude<LobbyCell, 'na'>, 'check' | 'clock' | 'minus' | 'alert'>> = {
  ok: 'check',
  wait: 'clock',
  skip: 'minus',
  bad: 'alert',
};

export const LOBBY_CELL_WORD: Readonly<Record<Exclude<LobbyCell, 'na'>, string>> = {
  ok: '완료',
  wait: '준비 중',
  skip: '건너뜀',
  bad: '접촉 불량',
};

/** 접촉 불량 라벨: 어느 전극인지 */
export function badElectrodeWord(e: Electrodes): string {
  if (e.left === 'bad' && e.right === 'bad') return 'L·R 전극';
  return e.left === 'bad' ? 'L 전극' : 'R 전극';
}

/** 로비 시트 종류(도크 항목 + 초대) */
export type LobbySheetKind = 'invite' | LobbyDockKind;

export const LOBBY_SHEET_TITLE: Readonly<Record<LobbySheetKind, string>> = {
  invite: '회원 초대',
  bgm: '대기실 BGM',
  band: '내 LINK BAND',
  speak: '발언권',
  chat: '채팅',
};
