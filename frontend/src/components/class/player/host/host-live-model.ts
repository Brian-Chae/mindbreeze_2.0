// SDD-208 H5 — 라이브 지표 행(SessionLiveMetric)을 상담사 화면 모델(HostParticipant)로 바꾼다.
// 판정 규칙은 metric-display(bandCardState)와 같고, 시계를 인자(nowMs)로 받아 테스트가 결정적이다.
// ClassPlayerPage 의 hostValues 도 이 모듈의 hostMetricValues 를 쓴다(규칙 한 곳).
import { SAM_AXES, samStepLabel } from '../../../../lib/api/checkin';
import type { SessionLiveMetric, SessionParticipant } from '../../../../lib/api/session';
import {
  EMPTY_HOST_VALUES,
  toHostMetricValues,
  type HostBand,
  type HostCheckinAnswer,
  type HostMetricValues,
  type HostParticipant,
  type HostQueueEntry,
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

const rounded = (value: number | null): number | null => value === null ? null : Math.round(value);

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
    relaxation: rounded(valid ? finite(row.current_efficiency) : null),
    // BPM·호흡·HRV 는 행(4초 폴링) 우선, extras(WS) 폴백 — 폴링이 WS 패치를 덮어도 깜빡이지 않는다
    heartRate: rounded(valid ? finite(row.heart_rate) ?? (extraValid ? extra.heartRate : null) : null),
    respiratoryRate: rounded(valid ? finite(row.respiratory_rate) ?? (extraValid ? extra.respiratoryRate : null) : null),
    focus: rounded(extraValid ? extra.focus : null),
    emotionalStability: rounded(extraValid ? extra.emotionalStability : null),
    // 회원 화면과 같은 SDNN 기준(rmssd 혼용 금지)
    hrv: rounded(valid ? finite(row.sdnn) ?? (extraValid ? extra.hrv : null) : null),
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
    checkinState: row.checkin_state,
    presenceState: row.presence_state,
    enteredAt: row.entered_at,
    attention: checkinAttention(checkin),
  };
}

/** 입장 대기자 명단 — id 는 서버 participant_id 를 우선한다(게스트는 user_id 가 없다) */
export function toHostQueue(participants: readonly SessionParticipant[]): HostQueueEntry[] {
  return participants
    .filter((p) => p.is_waitlisted)
    .map((p, i) => ({ id: p.participant_id ?? p.user_id ?? `queue-${i}`, name: p.user_name || p.guest_name || '대기 회원' }));
}

/** 일시적 null 로 값이 깜빡이는 것을 막기 위해 직전 값을 유지하는 시간 */
export const HOLD_LAST_VALUE_MS = 15_000;

export type HeldValues = Readonly<Record<string, { values: Partial<Record<keyof HostMetricValues, { value: number; at: number }>> }>>;

/**
 * band 가 on 인 참가자의 지표가 일시적으로 null 이면 직전 값을 HOLD_LAST_VALUE_MS 동안 유지한다.
 * 순수 함수: 이전 보관분을 받아 새 보관분과 보정된 참가자 목록을 돌려준다(입력 불변).
 * band 가 on 이 아니면(끊김·미착용) 유지하지 않고 보관분도 버린다.
 */
export function holdLastValues(
  participants: readonly HostParticipant[],
  prev: HeldValues,
  nowMs: number,
): { participants: HostParticipant[]; held: HeldValues } {
  const held: Record<string, { values: Partial<Record<keyof HostMetricValues, { value: number; at: number }>> }> = {};
  const out = participants.map((p) => {
    if (p.band !== 'on') return p;
    const keep = { ...(prev[p.id]?.values ?? {}) };
    const nextValues: Record<string, number | null> = { ...p.values };
    for (const key of Object.keys(p.values) as (keyof HostMetricValues)[]) {
      const v = p.values[key];
      if (v !== null) {
        keep[key] = { value: v, at: nowMs };
      } else {
        const last = keep[key];
        if (last && nowMs - last.at <= HOLD_LAST_VALUE_MS) nextValues[key] = last.value;
        else delete keep[key];
      }
    }
    held[p.id] = { values: keep };
    return { ...p, values: nextValues as unknown as HostMetricValues };
  });
  return { participants: out, held };
}
