// SDD-208 M1 — 회원 클래스 진행 화면 케이스 파생.
// 시안 member.html 의 state 키(place·mode·cam·mic·hand·band·net·view)와 같은 이름을 쓰고,
// 화면 문구(칩·슬롯 카드·미디어 버튼)는 이 파일에서만 만든다 → verify 문구 단언의 단일 출처.
// 회원 화면에는 다른 참가자와 견주는 수치(평균·순위·델타·종합점수) 코드를 두지 않는다(spec 합의 #5). 호흡 지시 문구도 두지 않는다(합의 #1).

import type { BandUi, CamUi, MicUi, NetUi } from './player-case';

export type MemberView = 'live' | 'waitlist' | 'end';
export type MemberHand = 'idle' | 'waiting' | 'speaking';
export type MemberNoticeTone = 'info' | 'caution' | 'coral' | 'live';

/** 케이스 입력 — 컨테이너(실제 훅 조립)와 픽스처(시안 CASES)가 같은 모양으로 만든다 */
export interface MemberCaseInput {
  view: MemberView;
  place: 'online' | 'offline';
  mode: '1on1' | 'group';
  /** 온라인에서 상담사 카메라 트랙이 있는가 — 없으면 상담사 PiP 를 그리지 않는다 */
  hostCamera: boolean;
  cam: CamUi;
  /** 그룹은 기본 muted, 발언권을 받으면 on. 오프라인은 none */
  mic: MicUi;
  hand: MemberHand;
  band: BandUi;
  net: NetUi;
  battery: number | null;
  /** linkband_mode !== 'none'. false 면 밴드 UI 전체를 숨긴다(plan D7) */
  bandEnabled: boolean;
  /** 온라인 그룹 정원 20명 초과 — 서버가 발행 권한을 주지 않는 수신 전용 수업(마이크·카메라·손들기 UI 없음) */
  viewerOnly: boolean;
}

export const MEMBER_CASE_DEFAULT: MemberCaseInput = {
  view: 'live',
  place: 'online',
  mode: '1on1',
  hostCamera: true,
  cam: 'on',
  mic: 'on',
  hand: 'idle',
  band: 'on',
  net: 'ok',
  battery: 80,
  bandEnabled: true,
  viewerOnly: false,
};

export function memberInput(partial: Partial<MemberCaseInput> = {}): MemberCaseInput {
  return { ...MEMBER_CASE_DEFAULT, ...partial };
}

export type MediaButtonState = 'on' | 'off' | 'denied' | 'muted' | 'speaking' | 'idle' | 'waiting';

export interface MediaButton {
  s: MediaButtonState;
  label: string;
  /** true = 눌리지 않는 상태 표시(aria-disabled) */
  disabled: boolean;
  /** 토글 계열 버튼의 눌림 상태. 상태 표시 전용 버튼은 undefined */
  pressed?: boolean;
}

export type MemberIconName =
  | 'hand' | 'mic' | 'micOff' | 'cameraOff' | 'signalLow' | 'battery' | 'alert' | 'wifiOff' | 'info' | 'bluetooth';

export interface MemberNotice {
  tone: MemberNoticeTone;
  icon: MemberIconName;
  text: string;
}

export type SlotAction = 'openDevice' | 'cancel' | 'retry' | 'continue';

export interface MemberSlotCard {
  tone: 'default' | 'coral';
  icon: MemberIconName;
  title?: string;
  text?: string;
  steps?: readonly string[];
  action?: { label: string; act: SlotAction };
}

export interface MemberRingModel {
  core: 'gauge' | 'dim' | 'msg';
  tone: 'live' | 'idle';
  /** 링 코어에 지표명·값을 그리는가(gauge·dim) */
  showValue: boolean;
  /** 줄바꿈은 \n — 시안의 <br> 위치 */
  title?: string;
  subtitle?: string;
  icon?: 'alert';
  dots?: boolean;
}

export type DockKey = 'status' | 'chat' | 'signal' | 'sound' | 'device';

const DOCK_LABEL: Record<DockKey, string> = {
  status: '내 상태',
  chat: '채팅',
  signal: '조용한 신호',
  sound: '소리',
  device: '기기',
};

export interface MemberCase {
  view: MemberView;
  place: 'online' | 'offline';
  mode: '1on1' | 'group';
  showHostPip: boolean;
  showMyPip: boolean;
  showMediaRow: boolean;
  /** 오프라인 현장 안내 카드(체크인 포함) */
  showSideCard: boolean;
  mic: MediaButton | null;
  cam: MediaButton | null;
  hand: MediaButton | null;
  /** 내 PiP 자리의 3상태(on·off·denied) 입력 — 내 PiP 가 없는 케이스에서도 값은 유지 */
  myCam: CamUi;
  notice: MemberNotice | null;
  slot: MemberSlotCard | null;
  showTrend: boolean;
  ring: MemberRingModel;
  conn: { ok: boolean; label: string; icon: 'dot' | 'wifi' | 'wifiOff' };
  banner: { title: string; text: string } | null;
  pipFrozen: boolean;
  netDown: boolean;
  dock: readonly { key: DockKey; label: string }[];
}

/* ───────── 칩 · 슬롯 카드 문구 ───────── */

function batteryText(battery: number | null): string {
  return battery === null ? '배터리가 부족해요 · 곧 충전해 주세요' : `배터리가 ${Math.round(battery)}%예요 · 곧 충전해 주세요`;
}

function groupNotice(input: MemberCaseInput): MemberNotice {
  if (input.hand === 'waiting') return { tone: 'info', icon: 'hand', text: '손들었어요 · 상담사가 확인 중이에요' };
  if (input.hand === 'speaking') return { tone: 'live', icon: 'mic', text: '말하는 중이에요 · 끝나면 말하기 종료를 눌러 주세요' };
  return { tone: 'info', icon: 'micOff', text: '이 수업은 기본 뮤트예요 · 말하고 싶을 땐 손들기를 눌러 주세요' };
}

function bandNotice(input: MemberCaseInput): MemberNotice | null {
  switch (input.band) {
    case 'weak': return { tone: 'caution', icon: 'signalLow', text: '접촉이 약해요 · 밴드를 이마에 살짝 밀착해 주세요' };
    case 'low': return { tone: 'caution', icon: 'battery', text: batteryText(input.battery) };
    case 'leadoff': return { tone: 'coral', icon: 'alert', text: '접촉이 확인되면 다시 측정해요' };
    case 'lost': return { tone: 'coral', icon: 'wifiOff', text: '밴드 연결이 끊겼어요 · 자동으로 다시 연결하고 있어요' };
    case 'unsupported': return { tone: 'info', icon: 'info', text: '이 브라우저에서는 밴드 연결이 안 돼요' };
    case 'pending': return { tone: 'info', icon: 'bluetooth', text: '연결되면 이 링에 내 상태가 나타나요' };
    case 'off': return { tone: 'info', icon: 'info', text: '밴드를 연결하면 내 상태가 이 링에 나타나요' };
    default: return null;
  }
}

/** 칩 우선순위: (온라인) 발언권·마이크·카메라 → 밴드. 시안 notice() 와 같은 순서 */
function deriveNotice(input: MemberCaseInput): MemberNotice | null {
  if (input.place === 'online') {
    if (input.mic === 'denied') {
      return { tone: 'coral', icon: 'micOff', text: '마이크 권한이 꺼져 있어요 · 아래 방법으로 허용해 주세요' };
    }
    if (input.mode === 'group' && !input.viewerOnly) return groupNotice(input);
    // D4: 회원 음성은 어떤 경우에도 AI 기록에 쓰이지 않으므로(F8) "AI 기록에서 빠져요" 대신 사실대로 안내한다
    if (input.mic === 'off') {
      return { tone: 'caution', icon: 'micOff', text: '마이크 꺼짐 · 상담사에게 내 목소리가 전달되지 않아요(뇌파는 계속 기록돼요)' };
    }
    if (input.cam === 'denied' || input.cam === 'nodevice') {
      return { tone: 'coral', icon: 'cameraOff', text: '수업은 그대로 계속돼요 · 설정에서 카메라를 허용해 주세요' };
    }
  }
  return input.bandEnabled ? bandNotice(input) : null;
}

const MIC_STEPS: readonly string[] = ['주소창의 자물쇠 아이콘을 눌러요', '마이크를 “허용”으로 바꿔요', '페이지를 새로 고쳐요'];

function deriveSlot(input: MemberCaseInput): MemberSlotCard | null {
  if (input.place === 'online' && input.mic === 'denied') {
    return { tone: 'coral', icon: 'micOff', title: '마이크 허용 방법', steps: MIC_STEPS };
  }
  if (!input.bandEnabled) return null;
  switch (input.band) {
    case 'off':
      return { tone: 'default', icon: 'bluetooth', text: '원하시면 기기에서 LINK BAND를 연결할 수 있어요.', action: { label: '밴드 연결', act: 'openDevice' } };
    case 'pending':
      return { tone: 'default', icon: 'bluetooth', text: '오래 걸리면 밴드 전원이 켜져 있는지 확인해 주세요.', action: { label: '취소', act: 'cancel' } };
    case 'leadoff':
      return { tone: 'coral', icon: 'alert', text: '밴드가 피부에 닿지 않았어요. 확인 방법을 볼 수 있어요.', action: { label: '확인 방법', act: 'openDevice' } };
    case 'lost':
      return { tone: 'coral', icon: 'wifiOff', text: '다시 연결해도 앞서 측정한 값은 안전하게 보관돼요.', action: { label: '다시 연결', act: 'retry' } };
    case 'unsupported':
      return { tone: 'default', icon: 'info', text: 'Chrome 또는 Edge로 열면 밴드를 연결할 수 있어요.', action: { label: '밴드 없이 계속', act: 'continue' } };
    default:
      return null;
  }
}

/* ───────── 링 ───────── */

function deriveRing(input: MemberCaseInput): MemberRingModel {
  if (!input.bandEnabled) {
    return { core: 'msg', tone: 'idle', showValue: false, title: '함께하는\n수업이에요', subtitle: '이 수업은 밴드 없이\n진행돼요' };
  }
  switch (input.band) {
    case 'off':
    case 'unsupported':
      return { core: 'msg', tone: 'idle', showValue: false, title: '밴드 없이\n참여 중이에요', subtitle: '측정 없이도 수업은\n그대로 진행돼요' };
    case 'pending':
      return { core: 'msg', tone: 'idle', showValue: false, dots: true, title: '밴드를 연결하는\n중이에요' };
    case 'leadoff':
      return { core: 'msg', tone: 'idle', showValue: false, icon: 'alert', title: '접촉을 확인해\n주세요' };
    case 'lost':
      return { core: 'dim', tone: 'idle', showValue: true, subtitle: '다시 연결하는\n중이에요' };
    default:
      return { core: 'gauge', tone: 'live', showValue: true };
  }
}

/* ───────── 미디어 줄 ───────── */

const MIC_ON: MediaButton = { s: 'on', label: '마이크 켜짐', disabled: false, pressed: true };
const MIC_OFF: MediaButton = { s: 'off', label: '마이크 꺼짐', disabled: false, pressed: false };
const MIC_DENIED: MediaButton = { s: 'denied', label: '마이크 막힘', disabled: true };

function micButton(input: MemberCaseInput): MediaButton {
  if (input.mic === 'denied') return MIC_DENIED;
  if (input.mode === 'group') {
    return input.hand === 'speaking'
      ? { s: 'speaking', label: '말하는 중', disabled: true }
      : { s: 'muted', label: '뮤트 중', disabled: true };
  }
  return input.mic === 'off' ? MIC_OFF : MIC_ON;
}

function camButton(input: MemberCaseInput): MediaButton {
  if (input.cam === 'denied' || input.cam === 'nodevice') return { s: 'denied', label: '카메라 막힘', disabled: true };
  return input.cam === 'off'
    ? { s: 'off', label: '카메라 꺼짐', disabled: false, pressed: false }
    : { s: 'on', label: '카메라 켜짐', disabled: false, pressed: true };
}

/** B1(손들기 취소 API)·B2(말하기 종료 API) 미적용 — 대기 중에는 취소 버튼 대신 상태만 보여 준다 */
function handButton(input: MemberCaseInput): MediaButton {
  if (input.hand === 'waiting') return { s: 'waiting', label: '손들었어요', disabled: true };
  if (input.hand === 'speaking') return { s: 'speaking', label: '말하기 종료', disabled: false, pressed: true };
  return { s: 'idle', label: '손들기', disabled: false, pressed: false };
}

function connIndicator(net: NetUi): MemberCase['conn'] {
  if (net === 'ok') return { ok: true, label: '연결됨', icon: 'dot' };
  if (net === 'reconnecting') return { ok: false, label: '재연결 중', icon: 'wifi' };
  return { ok: false, label: '연결 끊김', icon: 'wifiOff' };
}

function deriveDock(input: MemberCaseInput): MemberCase['dock'] {
  const keys: DockKey[] = ['status', 'chat', 'signal', 'sound', 'device'];
  return keys
    .filter((key) => {
      // 오프라인(같은 공간)에서는 조용한 신호 도크가 없다 — 시안 .app[data-place=offline] .dk[data-sheet=signal]
      if (key === 'signal') return input.place === 'online';
      if (key === 'status' || key === 'device') return input.bandEnabled;
      return true;
    })
    .map((key) => ({ key, label: DOCK_LABEL[key] }));
}

export function deriveMemberCase(input: MemberCaseInput): MemberCase {
  const online = input.place === 'online';
  const group = input.mode === 'group';
  const netDown = input.net === 'down';
  const mediaRow = online && !netDown && !input.viewerOnly;
  const slot = deriveSlot(input);

  return {
    view: input.view,
    place: input.place,
    mode: input.mode,
    showHostPip: online && input.hostCamera && !netDown,
    showMyPip: online && !group && !netDown && !input.viewerOnly,
    showMediaRow: mediaRow,
    showSideCard: !online && !netDown,
    mic: mediaRow ? micButton(input) : null,
    cam: mediaRow && !group ? camButton(input) : null,
    hand: mediaRow && group ? handButton(input) : null,
    myCam: input.cam,
    notice: deriveNotice(input),
    slot,
    showTrend: slot === null && input.bandEnabled,
    ring: deriveRing(input),
    conn: connIndicator(input.net),
    banner: input.net === 'reconnecting' ? { title: '연결이 불안정해요', text: '· 다시 연결 중이에요' } : null,
    pipFrozen: input.net !== 'ok',
    netDown,
    dock: deriveDock(input),
  };
}

/* ───────── 실제 미디어 상태 → 케이스 입력(mic·cam·hand) ───────── */

export interface MemberMediaState {
  place: 'online' | 'offline';
  mode: '1on1' | 'group';
  /** 서버 토큰의 발행 권한 — 1:1 은 항상 true, 그룹은 발언권을 받았을 때만 true */
  canPublish: boolean;
  /** 발언권 이벤트(speaking_changed) — 토큰 갱신보다 먼저 올 수 있다 */
  speaking: boolean;
  raisedHand: boolean;
  /** 회원 본인의 선택 — 마이크는 기본 켜짐, 카메라는 기본 꺼짐(spec 결정 #1) */
  micWanted: boolean;
  camWanted: boolean;
  micFailure: 'denied' | null;
  camFailure: 'denied' | 'nodevice' | null;
}

export interface MemberMediaInput {
  mic: MicUi;
  cam: CamUi;
  hand: MemberHand;
}

/**
 * 그룹에서 "말하기 종료"는 서버 발언권을 돌려주는 API(B2)가 없어 로컬 마이크 끄기로 대신한다.
 * 그래서 발언권을 가진 채 micWanted=false 이면 화면은 다시 "뮤트 중 · 손들기"로 보여 주고,
 * 이때 손들기는 서버 호출 없이 마이크만 다시 켠다(컨테이너 처리).
 */
export function deriveMemberMedia(state: MemberMediaState): MemberMediaInput {
  if (state.place === 'offline') return { mic: 'none', cam: 'none', hand: 'idle' };

  const micDenied = state.micFailure === 'denied';
  if (state.mode === 'group') {
    const granted = state.canPublish || state.speaking;
    const speaking = granted && state.micWanted;
    return {
      mic: micDenied ? 'denied' : speaking ? 'on' : 'muted',
      cam: 'off',
      hand: speaking ? 'speaking' : state.raisedHand && !granted ? 'waiting' : 'idle',
    };
  }

  const cam: CamUi = state.camFailure ?? (state.camWanted ? 'on' : 'off');
  return { mic: micDenied ? 'denied' : state.micWanted ? 'on' : 'off', cam, hand: 'idle' };
}
