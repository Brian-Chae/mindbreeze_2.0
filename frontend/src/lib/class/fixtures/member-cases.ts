// SDD-208 — 회원 케이스 M01~M21 입력 픽스처. 하니스(/design/class-player?role=member&case=Mxx)와 단위·컴포넌트 테스트가 함께 쓴다.
// 입력은 시안 member.html 의 CASES 표와 같은 키 이름이다. 서버·BLE·LiveKit 호출은 없다.
import { createElement } from 'react';
import { MemberCaseDemo, MemberChatDemo } from '../../../components/class/player/member/MemberCaseDemo';
import { metricDef, type MetricSeries, type MetricSnapshot } from '../../../components/class/player/member/member-metrics';
import type { MemberClassViewProps, MemberSheetKey } from '../../../components/class/player/member/member-view-types';
import { memberInput, type MemberCaseInput } from '../member-player-case';
import type { PlayerMetricKey } from '../player-case';
import { HARNESS_BACKDROP_SRC, type PlayerCaseContext, type PlayerCaseMap } from '../player-harness';

export const MEMBER_CASE_IDS: readonly string[] = Array.from({ length: 21 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);

/** 시안 CASES — 기본값(memberInput)과 다른 키만 적는다 */
const CASE_OVERRIDES: Record<string, Partial<MemberCaseInput>> = {
  M01: {},
  M02: { mode: 'group', mic: 'muted' },
  M03: { mode: 'group', mic: 'muted', hand: 'waiting' },
  M04: { mode: 'group', mic: 'on', hand: 'speaking' },
  M05: { place: 'offline', mic: 'none', cam: 'none' },
  M06: { place: 'offline', mic: 'none', cam: 'none', band: 'off' },
  M07: { band: 'off' },
  M08: { band: 'pending' },
  M09: { band: 'weak' },
  M10: { band: 'leadoff' },
  M11: { band: 'lost' },
  M12: { band: 'low', battery: 15 },
  M13: { band: 'unsupported' },
  M14: { mic: 'off' },
  M15: { mic: 'denied' },
  M16: { cam: 'off' },
  M17: { cam: 'denied' },
  M18: { net: 'reconnecting' },
  M19: { net: 'down' },
  M20: { view: 'waitlist' },
  M21: { view: 'end' },
};

export const MEMBER_CASE_INPUTS: Record<string, MemberCaseInput> = Object.fromEntries(
  MEMBER_CASE_IDS.map((id) => [id, memberInput(CASE_OVERRIDES[id])]),
);

/** 시안에서 열린 채로 시작하는 시트(M10 = 접촉 확인) */
const SHEET_PRESET: Record<string, MemberSheetKey> = { M10: 'device' };

const SHEET_KEYS: readonly string[] = ['status', 'chat', 'signal', 'sound', 'device'];
const isSheetKey = (key: string | null | undefined): key is MemberSheetKey => !!key && SHEET_KEYS.includes(key);

/** 시안 METRICS — 현재값과 5분 전 값 */
const DEMO_VALUES: Record<PlayerMetricKey, { value: number; start: number; seed: number }> = {
  focus: { value: 58, start: 55, seed: 1.3 },
  relaxation: { value: 72, start: 64, seed: 0.4 },
  emotional: { value: 64, start: 59, seed: 2.2 },
  bpm: { value: 68, start: 72, seed: 0.9 },
  respiration: { value: 11, start: 13, seed: 1.8 },
  hrv: { value: 52, start: 46, seed: 2.9 },
};

const SERIES_LENGTH = 300;

/** 시작값에서 현재값까지 완만히 이어지는 5분(1Hz) 결정적 시계열 */
function demoSeries(key: PlayerMetricKey): number[] {
  const { value, start, seed } = DEMO_VALUES[key];
  const [min, max] = metricDef(key).scale.member;
  const amp = (max - min) * 0.035;
  return Array.from({ length: SERIES_LENGTH }, (_, i) => {
    const t = i / (SERIES_LENGTH - 1);
    const ease = t * t * (3 - 2 * t) * 0.6 + t * 0.4;
    const wobble = (Math.sin(i * 0.19 + seed) + 0.6 * Math.sin(i * 0.08 + seed * 2)) * amp * Math.sin(Math.PI * t);
    return start + (value - start) * ease + wobble;
  });
}

function demoSnapshot(): MetricSnapshot {
  return {
    focus: DEMO_VALUES.focus.value,
    relaxation: DEMO_VALUES.relaxation.value,
    emotional: DEMO_VALUES.emotional.value,
    bpm: DEMO_VALUES.bpm.value,
    respiration: DEMO_VALUES.respiration.value,
    hrv: DEMO_VALUES.hrv.value,
  };
}

function demoAllSeries(): MetricSeries {
  return {
    focus: demoSeries('focus'),
    relaxation: demoSeries('relaxation'),
    emotional: demoSeries('emotional'),
    bpm: demoSeries('bpm'),
    respiration: demoSeries('respiration'),
    hrv: demoSeries('hrv'),
  };
}

function demoWave(phase: number, a1: number, a2: number): number[] {
  return Array.from({ length: 120 }, (_, i) => Math.sin(i * 0.42 + phase) * a1 + Math.sin(i * 1.14 + phase * 2) * a2);
}

function isHeroKey(key: string | null): key is PlayerMetricKey {
  return key !== null && key in DEMO_VALUES;
}

/** 하니스·테스트용 뷰 props. 액션은 전부 no-op(테스트가 스파이로 덮어쓴다) */
export function memberCaseViewProps(id: string, ctx?: Partial<Pick<PlayerCaseContext, 'sheet' | 'params' | 'backdropSrc'>>): MemberClassViewProps {
  const input = MEMBER_CASE_INPUTS[id] ?? MEMBER_CASE_INPUTS.M01;
  const metricParam = ctx?.params?.get('metric') ?? null;
  const sheetParam = ctx?.sheet ?? null;
  // 하니스 전용: ?hostvideo=failed|waiting 으로 상담사 영상 연결 문제 칩을 재현한다(트랙 없음)
  const hostVideoParam = ctx?.params?.get('hostvideo') ?? null;
  const hostVideoIssue = hostVideoParam === 'failed' || hostVideoParam === 'waiting' ? hostVideoParam : null;
  const low = input.band === 'low';
  const weak = input.band === 'weak';
  const noop = (): void => undefined;
  return {
    input: hostVideoIssue ? { ...input, hostCamera: false } : input,
    hostVideoIssue,
    header: { title: '마음챙김 명상수업 · 4회차', elapsedSec: 754, totalSec: 1800, counselorName: '채용욱', myInitial: '수' },
    hero: isHeroKey(metricParam) ? metricParam : 'relaxation',
    snapshot: demoSnapshot(),
    series: demoAllSeries(),
    device: {
      battery: low ? 15 : 82,
      signalLabel: weak ? '약함' : '좋음',
      contactLabel: weak ? '약함' : '양호',
      connectedElapsedSec: 12 * 60,
      error: null,
      analyzing: false,
      raw: { fp1: demoWave(0.5, 7, 4), fp2: demoWave(2.1, 6, 5) },
      ppg: { red: demoWave(0.9, 3, 4), ir: demoWave(1.7, 3, 5) },
      isMock: false,
      pendingCount: input.net === 'down' ? 12 : 0,
    },
    sound: { speakerOn: input.place !== 'offline', trackTitle: '고요한 숲의 아침', volume: 0.6, blocked: false, onsiteLabel: '고요한 숲의 아침' },
    chat: { enabled: true, authenticated: true, unread: 2, node: createElement(MemberChatDemo) },
    sheet: isSheetKey(sheetParam) ? sheetParam : (SHEET_PRESET[id] ?? null),
    backdropSrc: ctx?.backdropSrc ?? HARNESS_BACKDROP_SRC,
    end: {
      title: '마음챙김 명상수업 · 4회차',
      durationLabel: '30분',
      actionLabel: '대시보드로 이동',
      reportPanel: createElement('p', { className: 'mp-note' }, '리포트를 받을 이메일을 입력하면 코치 승인 후 메일로 보내 드려요.'),
      checkinPanel: createElement('p', { className: 'mp-note' }, '오늘 수업 이후 상태를 남길 수 있어요.'),
    },
    waitlist: { title: '마음챙김 명상수업 · 4회차', counselorName: '채용욱', startLabel: '14:00', notifyByPush: true },
    actions: {
      onLeave: noop, onHeroChange: noop, onSheetChange: noop, onToggleMic: noop, onToggleCam: noop, onRaiseHand: noop, onEndSpeaking: noop,
      onBandConnect: noop, onBandDisconnect: noop, onBandCancel: noop, onBandRetry: noop, onBandContinue: noop, onBandRecheck: noop,
      onNetRetry: noop, onHostVideoRetry: noop, onSignal: () => 'sent', onSpeakerChange: noop, onVolumeChange: noop, onResumeAudio: noop, onScreenOff: noop,
      onCheckin: noop, onEndAction: noop, onWaitlistLeave: noop,
    },
  };
}

export const playerCases: PlayerCaseMap = Object.fromEntries(
  MEMBER_CASE_IDS.map((id) => [
    id,
    { role: 'member' as const, render: (ctx: PlayerCaseContext) => createElement(MemberCaseDemo, { key: `${id}:${ctx.params.toString()}`, initial: memberCaseViewProps(id, ctx) }) },
  ]),
);
