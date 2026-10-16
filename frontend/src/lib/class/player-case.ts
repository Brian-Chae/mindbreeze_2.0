// SDD-208 — 클래스 진행 화면(회원·상담사) 공용 케이스 모델.
// 케이스를 저장하지 않고 입력 상태에서 순수함수로 파생한다. 시안(member.html·counselor.html)의 상태 키와 같은 이름을 쓴다.

import type { BandConnectionState } from '../../hooks/useBand';
import type { DeviceStatus } from '../api/session';
import { isLowBattery, resolveBandLinkState, type SignalQualityLevel } from '../session-live/signal-status';

export type BandUi = 'on' | 'off' | 'pending' | 'weak' | 'leadoff' | 'lost' | 'low' | 'unsupported';
export type NetUi = 'ok' | 'reconnecting' | 'down';
/** muted = 그룹 기본 뮤트, none = 오프라인(마이크 UI 없음) */
export type MicUi = 'on' | 'off' | 'denied' | 'muted' | 'none';
export type CamUi = 'on' | 'off' | 'denied' | 'nodevice' | 'none';

/** useBand 출력에서 그대로 옮긴 값 + 컨테이너가 보관하는 everConnected */
export interface BandInput {
  connectionState: BandConnectionState;
  /** 이번 화면에서 한 번이라도 connected 가 된 적이 있는가 — 미착용(off)과 끊김(lost) 구분용 */
  everConnected: boolean;
  deviceStatus: DeviceStatus | null;
  signalQualityLevel: SignalQualityLevel;
  battery: number | null;
  lastEegAt: string | null;
}

/**
 * 밴드 UI 상태. 우선순위: unsupported > pending(최초 연결 시도) > leadoff > lost > weak > low > on > off.
 * 임계값은 새로 만들지 않고 기존 signal-status 의 판정(EEG stale 10초, 배터리 25% 이하)을 재사용한다.
 */
export function deriveBandUi(input: BandInput, nowMs: number): BandUi {
  if (input.connectionState === 'unsupported') return 'unsupported';
  // 이미 연결된 적이 있는 밴드가 끊긴 뒤 자동 재연결(connecting)을 거칠 때 lost↔pending 깜박임을 막는다
  if (input.connectionState === 'connecting') return input.everConnected ? 'lost' : 'pending';
  if (input.deviceStatus === 'lead_off') return 'leadoff';

  const link = resolveBandLinkState({
    bleConnected: input.connectionState === 'connected',
    lastEegAt: input.lastEegAt,
    nowMs,
  });
  if (link === 'stale') return 'lost';
  if (link === 'disconnected') return input.everConnected ? 'lost' : 'off';

  if (input.signalQualityLevel === 'degraded' || input.signalQualityLevel === 'invalid') return 'weak';
  if (isLowBattery(input.battery)) return 'low';
  return 'on';
}

/** 소켓이 끊긴 채 이 시간(ms)이 지나면 reconnecting 에서 down 으로 본다. plan D9 미확정 — 잠정값 */
export const NET_DOWN_AFTER_MS = 15_000;

export interface NetInput {
  socketConnected: boolean;
  browserOnline: boolean;
  /** 정상 연결이 끊긴 뒤 경과 시간(ms). 정상일 때는 값이 무엇이든 무시한다 */
  downForMs: number;
}

export function deriveNetUi(input: NetInput): NetUi {
  if (input.socketConnected && input.browserOnline) return 'ok';
  return input.downForMs >= NET_DOWN_AFTER_MS ? 'down' : 'reconnecting';
}

export type PlayerMetricKey = 'focus' | 'relaxation' | 'emotional' | 'bpm' | 'respiration' | 'hrv';
export type PlayerMetricGroup = 'MIND' | 'BODY';

export interface PlayerMetric {
  readonly key: PlayerMetricKey;
  readonly label: string;
  /** 타일·지표 띠 라벨용 약칭 */
  readonly short: string;
  readonly unit: string;
  readonly group: PlayerMetricGroup;
  /** 링 게이지 표시 범위 [min, max] — 회원 화면과 상담사 화면의 시안 스케일이 다르다 */
  readonly scale: { readonly member: readonly [number, number]; readonly host: readonly [number, number] };
  /** player-tokens.css 의 지표 고유색 CSS 변수 이름 */
  readonly colorVar: string;
}

export const PLAYER_METRICS: readonly PlayerMetric[] = [
  { key: 'focus', label: '집중도', short: '집중', unit: '%', group: 'MIND', scale: { member: [0, 100], host: [0, 100] }, colorVar: '--m-focus' },
  { key: 'relaxation', label: '이완도', short: '이완', unit: '%', group: 'MIND', scale: { member: [0, 100], host: [0, 100] }, colorVar: '--m-relax' },
  { key: 'emotional', label: '감정균형도', short: '감정', unit: '%', group: 'MIND', scale: { member: [0, 100], host: [0, 100] }, colorVar: '--m-emotion' },
  { key: 'bpm', label: 'BPM', short: 'BPM', unit: 'bpm', group: 'BODY', scale: { member: [40, 140], host: [50, 110] }, colorVar: '--m-bpm' },
  { key: 'respiration', label: '호흡', short: '호흡', unit: '회/분', group: 'BODY', scale: { member: [5, 30], host: [6, 24] }, colorVar: '--m-resp' },
  { key: 'hrv', label: 'HRV', short: 'HRV', unit: 'ms', group: 'BODY', scale: { member: [10, 100], host: [10, 90] }, colorVar: '--m-hrv' },
];
