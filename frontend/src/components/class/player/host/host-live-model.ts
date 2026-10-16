// SDD-208 H5 — 라이브 지표 행(SessionLiveMetric)을 상담사 화면 모델(HostParticipant)로 바꾼다.
// 판정 규칙은 ClassPlayerPage 의 hostValues·metric-display(bandCardState)와 같고, 시계를 인자(nowMs)로 받아 테스트가 결정적이다.
// (ClassPlayerPage 의 hostValues 는 비공개라 같은 규칙을 여기에 둔다 — I1 에서 그 파일이 이 모듈로 수렴하면 중복이 사라진다)
import { SAM_AXES, samStepLabel } from '../../../../lib/api/checkin';
import type { SessionLiveMetric } from '../../../../lib/api/session';
import {
  EMPTY_HOST_VALUES,
  toHostMetricValues,
  type HostBand,
  type HostCheckinAnswer,
  type HostMetricValues,
  type HostParticipant,
} from '../../../../lib/class/host-player-case';
import { isEegStale, isLowBattery } from '../../../../lib/session-live/signal-status';
import type { WaitingRoomCheckin } from '../../../../lib/socket';
import type { WaitingRoomEntry } from '../../../../hooks/useWaitingRoomCount';

/** ClassPlayerPage 의 HostExtra 와 같은 모양(WS eeg_feature 로 받은 집중·정서·HRV·BPM·호흡) */
export interface HostMetricExtra {
  at: number;
  focus: number | null;
  emotionalStability: number | null;
  hrv: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
}

const EXTRA_FRESH_MS = 10_000;

const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function connectionFailed(row: SessionLiveMetric, nowMs: number): boolean {
  if (row.device_status === 'disconnected') return true;
  if (row.last_eeg_at == null && !row.band_connected) return false;
  if (!row.band_connected) return true;
  return isEegStale(row.last_eeg_at, nowMs);
}

export function hostBandOf(row: SessionLiveMetric, nowMs: number): HostBand {
  if (row.last_eeg_at == null && !row.band_connected) return 'off';
  if (connectionFailed(row, nowMs)) return 'lost';
  return row.device_status === 'lead_off' ? 'leadoff' : 'on';
}

export function hostMetricValues(row: SessionLiveMetric, extra: HostMetricExtra | undefined, nowMs: number): HostMetricValues {
  const valid = row.band_connected && row.device_status === 'ok' && !isEegStale(row.last_eeg_at, nowMs);
  const extraValid = valid && extra !== undefined && nowMs - extra.at < EXTRA_FRESH_MS;
  return toHostMetricValues({
    relaxation: valid ? finite(row.current_efficiency) : null,
    // BPM·호흡·HRV 는 행(4초 폴링) 우선, extras(WS) 폴백 — 폴링이 WS 패치를 덮어도 깜빡이지 않는다
    heartRate: valid ? finite(row.heart_rate) ?? (extraValid ? extra.heartRate : null) : null,
    respiratoryRate: valid ? finite(row.respiratory_rate) ?? (extraValid ? extra.respiratoryRate : null) : null,
    focus: extraValid ? extra.focus : null,
    emotionalStability: extraValid ? extra.emotionalStability : null,
    // 회원 화면과 같은 SDNN 기준(rmssd 혼용 금지)
    hrv: valid ? finite(row.sdnn) ?? (extraValid ? extra.hrv : null) : null,
  });
}

export function agoLabelOf(lastEegAt: string | null, nowMs: number): string | null {
  if (!lastEegAt) return null;
  const ts = new Date(lastEegAt).getTime();
  if (Number.isNaN(ts)) return null;
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

export function checkinAnswers(checkin: WaitingRoomCheckin | null | undefined): HostCheckinAnswer[] {
  if (!checkin) return [];
  const answers: HostCheckinAnswer[] = [];
  for (const axis of SAM_AXES) {
    const value = checkin[axis.key];
    const label = samStepLabel(axis.key, value);
    if (label) answers.push([axis.label, label]);
  }
  if (checkin.note) answers.push(['전달 말', checkin.note]);
  return answers;
}

/** 상담사가 살펴볼 만한 응답 한 줄 — 편안함이 낮으면 그 단계, 아니면 전달 말 */
export function checkinAttention(checkin: WaitingRoomCheckin | null | undefined): string | null {
  if (!checkin) return null;
  if (checkin.valence !== null && checkin.valence <= 2) {
    const label = samStepLabel('valence', checkin.valence);
    if (label) return `편안함 ${label}`;
  }
  return checkin.note ?? null;
}

interface ToHostParticipantOptions {
  extra?: HostMetricExtra;
  entry?: Pick<WaitingRoomEntry, 'checkin'>;
  nowMs: number;
}

export function toHostParticipant(row: SessionLiveMetric, { extra, entry, nowMs }: ToHostParticipantOptions): HostParticipant {
  const band = hostBandOf(row, nowMs);
  const checkin = entry?.checkin ?? null;
  return {
    id: row.participant_id,
    name: row.display_name || (row.is_guest ? '게스트' : '참가자'),
    band,
    values: band === 'on' ? hostMetricValues(row, extra, nowMs) : EMPTY_HOST_VALUES,
    lowBattery: (band === 'on' || band === 'leadoff') && isLowBattery(row.band_battery),
    hand: row.raise_hand === true,
    speaking: row.speaking === true,
    agoLabel: band === 'lost' ? agoLabelOf(row.last_eeg_at, nowMs) : null,
    checkin: checkinAnswers(checkin),
    attention: checkinAttention(checkin),
  };
}
