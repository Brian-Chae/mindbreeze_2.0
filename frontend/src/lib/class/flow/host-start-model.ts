// SDD-209 H7 — FH07 시작 확인 시트 파생 + 시작 시 녹음 선언 결정 + FH08 나가기/닫기 문구.
// 참가자의 리포트 제외·연구 동의는 익명 인원 수로만 보이며 시작을 막지 않는다(P2). 수동 기록은 상담사의 녹음 해제·마이크 끔에 한한다.
import { lobbyStatusLine, type LobbyCell, type LobbyContext, type LobbyModel, type LobbyRow } from './host-lobby-model';

export interface StartSheetInput {
  model: LobbyModel;
  ctx: LobbyContext;
  /** 이 기기 마이크가 켜져 있는가(온라인 점검 결과) */
  micOn: boolean;
  /** 상담사가 `녹음하고 AI 기록지를 만들어요` 를 체크했는가 */
  recordChecked: boolean;
  /** 리포트에 반영하지 않는 참가자 수(익명) */
  excluded: number;
  /** 연구 목적 활용에 동의한 참가자 수(익명) */
  research: number;
  /** 기록 원본 보관 기간(서버 설정값). 모르면 null */
  retentionDays: number | null;
}

export interface PendingMember {
  id: string;
  name: string;
  /** 미완 단계 칩 */
  chips: Array<{ label: string; bad: boolean }>;
}

export interface StartSheetView {
  empty: boolean;
  peopleText: string;
  pending: PendingMember[];
  /** 접었을 때 보이는 앞 N명 */
  shown: PendingMember[];
  moreCount: number;
  micRow: 'place' | 'on' | 'off';
  /** 녹음 체크 상태 */
  checked: boolean;
  checkboxDisabled: boolean;
  manual: boolean;
  note: string;
  retentionText: string;
  countRows: Array<{ kind: 'excluded' | 'research'; text: string }>;
  primaryLabel: string;
  secondaryLabel: string;
}

const FOLD_FROM = 6;
const FOLD_SHOW = 3;

function chipsOf(row: LobbyRow): PendingMember['chips'] {
  const out: PendingMember['chips'] = [];
  const add = (label: string, cell: LobbyCell): void => {
    if (cell === 'wait') out.push({ label, bad: false });
    if (cell === 'bad') out.push({ label, bad: true });
  };
  add('설문', row.survey);
  add('LINK BAND', row.band);
  add('기기', row.device);
  return out;
}

export function retentionText(days: number | null): string {
  return days && days > 0 ? `기록 원본은 ${days}일 후 삭제돼요` : '기록 원본은 설정된 기간이 지나면 삭제돼요';
}

/** 오프라인은 이 기기 마이크로 녹음할 수 있다(권한은 녹음 시작 시 요청). 온라인은 마이크가 켜져 있어야 한다 */
export function isRecordable(ctx: Pick<LobbyContext, 'place'>, micOn: boolean): boolean {
  return ctx.place === 'offline' ? true : micOn;
}

export function deriveStartSheet(input: StartSheetInput): StartSheetView {
  const { model, ctx, micOn, recordChecked } = input;
  const empty = model.rows.length === 0;
  const pending: PendingMember[] = model.rows.filter((r) => !r.ready).map((r) => ({ id: r.id, name: r.name, chips: chipsOf(r) }));
  const shown = pending.length >= FOLD_FROM ? pending.slice(0, FOLD_SHOW) : pending;
  const recordable = isRecordable(ctx, micOn);
  const checked = recordable && recordChecked;
  const manual = !checked;
  const waiting = pending.length > 0 || empty;
  const countRows: StartSheetView['countRows'] = [];
  if (input.excluded > 0) countRows.push({ kind: 'excluded', text: `리포트에 반영하지 않는 참가자 ${input.excluded}명` });
  if (input.research > 0) countRows.push({ kind: 'research', text: `연구 목적 활용에 동의한 참가자 ${input.research}명` });
  return {
    empty,
    peopleText: empty ? '아직 아무도 입장하지 않았어요' : lobbyStatusLine(model.stats),
    pending,
    shown,
    moreCount: pending.length - shown.length,
    micRow: ctx.place === 'offline' ? 'place' : micOn ? 'on' : 'off',
    checked,
    checkboxDisabled: !recordable,
    manual,
    note: manual ? '녹음 없이 수동 기록으로 진행해요. 메모로 기록지를 만들어요.' : '녹음은 언제든 멈출 수 있어요.',
    retentionText: retentionText(input.retentionDays),
    countRows,
    primaryLabel: waiting ? '지금 시작하기' : '시작하기',
    secondaryLabel: waiting ? '조금 더 기다리기' : '돌아가기',
  };
}

/** 시작 시 서버에 선언하는 녹음 방식. record 면 audio/start(true)+녹음 시작, manual 이면 audio/start(false)(수동 기록 선언) */
export type StartAudioPlan = 'record' | 'manual';

export function resolveStartAudio(input: Pick<StartSheetInput, 'ctx' | 'micOn' | 'recordChecked'>): StartAudioPlan {
  return isRecordable(input.ctx, input.micOn) && input.recordChecked ? 'record' : 'manual';
}

/** 시작 호출 순서(검증: 오픈 상태에서 audio/start 호출 0, 시작 직후 ConsentModal 0) */
export type StartStep = 'transition-start' | 'livekit-connect' | 'audio-start-true' | 'recorder-start' | 'audio-start-false' | 'video-start';

export function planStartSequence(input: { place: LobbyContext['place']; audio: StartAudioPlan; recordVideo: boolean; cameraOn: boolean }): StartStep[] {
  const steps: StartStep[] = ['transition-start'];
  if (input.place === 'online') steps.push('livekit-connect');
  if (input.audio === 'record') steps.push('audio-start-true', 'recorder-start');
  else steps.push('audio-start-false');
  if (input.place === 'online' && input.recordVideo && input.cameraOn) steps.push('video-start');
  return steps;
}

// ───────── FH08 나가기·닫기 ─────────

export interface LeaveCopy {
  intro: string;
  leaveDesc: string;
  closeDesc: string;
  confirmBody: string;
}

export function leaveCopy(waiting: number): LeaveCopy {
  if (waiting <= 0) {
    return {
      intro: '지금은 대기 중인 회원이 없어요.',
      leaveDesc: '클래스는 열린 채로 두어요. 회원이 들어오면 대기실에서 기다려요.',
      closeDesc: '클래스가 닫혀요. 닫은 클래스는 다시 열 수 없어요.',
      confirmBody: '닫힌 클래스는 다시 열 수 없어요. 같은 설정으로 새 클래스를 만들 수 있어요.',
    };
  }
  return {
    intro: `지금 대기실에 회원 ${waiting}명이 있어요.`,
    leaveDesc: `클래스는 열린 채로 두어요. 회원 ${waiting}명은 대기실에서 기다리고, 돌아오면 이어서 시작할 수 있어요.`,
    closeDesc: `회원 ${waiting}명이 모두 퇴장해요. 닫은 클래스는 다시 열 수 없어요.`,
    confirmBody: `대기 중인 회원 ${waiting}명이 모두 퇴장하고, 닫힌 클래스는 다시 열 수 없어요. 같은 설정으로 새 클래스를 만들 수 있어요.`,
  };
}
