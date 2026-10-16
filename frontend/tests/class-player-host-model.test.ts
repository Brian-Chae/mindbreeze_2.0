// SDD-208 H5 — 라이브 지표 행(SessionLiveMetric) → 상담사 화면 모델(HostParticipant) 변환
import { describe, expect, it } from 'vitest';
import type { SessionLiveMetric } from '../src/lib/api/session';
import {
  agoLabelOf,
  checkinAnswers,
  checkinAttention,
  hostBandOf,
  hostMetricValues,
  toHostParticipant,
  toHostQueue,
  type HostMetricExtra,
} from '../src/components/class/player/host/host-live-model';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const isoAgo = (ms: number): string => new Date(NOW - ms).toISOString();

function row(over: Partial<SessionLiveMetric> = {}): SessionLiveMetric {
  return {
    participant_id: 'p1',
    user_id: 'u1',
    display_name: '서연',
    is_guest: false,
    band_connected: true,
    device_status: 'ok',
    band_battery: 80,
    avg_efficiency: null,
    current_efficiency: 70,
    upload_status: null,
    last_eeg_at: isoAgo(2_000),
    heart_rate: 72,
    respiratory_rate: 14,
    sdnn: 52,
    raise_hand: false,
    speaking: false,
    ...over,
  };
}
const extra = (over: Partial<HostMetricExtra> = {}): HostMetricExtra => ({
  at: NOW - 1_000, focus: 68, emotionalStability: 74, hrv: 50, heartRate: 71, respiratoryRate: 13, ...over,
});

describe('hostBandOf — 밴드 상태(연결됨·미착용·끊김·접촉 불량)', () => {
  it('EEG 이력 없이 미연결이면 미착용(오류가 아님)', () => {
    expect(hostBandOf(row({ band_connected: false, last_eeg_at: null, device_status: null }), NOW)).toBe('off');
  });

  it('연결되어 최근 EEG 가 있으면 연결됨', () => {
    expect(hostBandOf(row(), NOW)).toBe('on');
  });

  it('EEG 가 10초 넘게 끊기면 끊김', () => {
    expect(hostBandOf(row({ last_eeg_at: isoAgo(30_000) }), NOW)).toBe('lost');
    expect(hostBandOf(row({ band_connected: false, last_eeg_at: isoAgo(5_000) }), NOW)).toBe('lost');
  });

  it('접촉 불량(lead_off)은 연결됨보다 우선한다', () => {
    expect(hostBandOf(row({ device_status: 'lead_off' }), NOW)).toBe('leadoff');
  });
});

describe('hostMetricValues — 현행 hostValues 규칙을 새 지표 키로', () => {
  it('유효한 행: 이완=current_efficiency, BPM·호흡·HRV 는 행 값, 집중·감정은 최근 extras', () => {
    const v = hostMetricValues(row(), extra(), NOW);
    expect(v).toEqual({ focus: 68, relaxation: 70, emotional: 74, bpm: 72, respiration: 14, hrv: 52 });
  });

  it('행 값이 비면 10초 이내 extras 로 BPM·호흡·HRV 를 채운다', () => {
    const v = hostMetricValues(row({ heart_rate: null, respiratory_rate: null, sdnn: null }), extra(), NOW);
    expect([v.bpm, v.respiration, v.hrv]).toEqual([71, 13, 50]);
  });

  it('10초 지난 extras 는 쓰지 않는다', () => {
    const v = hostMetricValues(row(), extra({ at: NOW - 20_000 }), NOW);
    expect([v.focus, v.emotional]).toEqual([null, null]);
  });

  it('접촉 불량·미연결이면 전부 null', () => {
    const empty = { focus: null, relaxation: null, emotional: null, bpm: null, respiration: null, hrv: null };
    expect(hostMetricValues(row({ device_status: 'lead_off' }), extra(), NOW)).toEqual(empty);
    expect(hostMetricValues(row({ band_connected: false }), extra(), NOW)).toEqual(empty);
  });
});

describe('agoLabelOf — 마지막 수신 경과', () => {
  it.each([
    [isoAgo(30_000), '30초 전'],
    [isoAgo(130_000), '2분 전'],
    [isoAgo(3 * 3600_000), '3시간 전'],
  ])('%s → %s', (iso, label) => {
    expect(agoLabelOf(iso, NOW)).toBe(label);
  });

  it('수신 이력이 없으면 null', () => {
    expect(agoLabelOf(null, NOW)).toBeNull();
  });
});

describe('입장 전 체크인 → 응답·살펴볼 응답', () => {
  it('SAM 3축을 단계 라벨로, 전달 말은 "전달 말"로 옮긴다', () => {
    const answers = checkinAnswers({ arousal: 4, valence: 2, emotion: null, note: '긴장돼요' });
    expect(answers).toEqual([['집중', '집중'], ['편안함', '불편'], ['전달 말', '긴장돼요']]);
  });

  it('체크인이 없으면 빈 배열', () => {
    expect(checkinAnswers(null)).toEqual([]);
  });

  it('편안함이 낮으면 살펴볼 응답, 아니면 전달 말이 있을 때만', () => {
    expect(checkinAttention({ arousal: 3, valence: 2, emotion: 3, note: null })).toBe('편안함 불편');
    expect(checkinAttention({ arousal: 3, valence: 4, emotion: 3, note: '어깨가 뻐근해요' })).toBe('어깨가 뻐근해요');
    expect(checkinAttention({ arousal: 3, valence: 4, emotion: 3, note: null })).toBeNull();
    expect(checkinAttention(null)).toBeNull();
  });
});

describe('toHostParticipant', () => {
  it('이름·손들기·말하는 중·낮은 배터리·체크인을 모은다', () => {
    const p = toHostParticipant(
      row({ raise_hand: true, band_battery: 20 }),
      { extra: extra(), entry: { participantId: 'p1', nickname: '서연', checkin: { arousal: 4, valence: 4, emotion: 4, note: null } }, nowMs: NOW },
    );
    expect(p.id).toBe('p1');
    expect(p.name).toBe('서연');
    expect(p.band).toBe('on');
    expect(p.hand).toBe(true);
    expect(p.speaking).toBe(false);
    expect(p.lowBattery).toBe(true);
    expect(p.checkin.length).toBe(3);
    expect(p.values.relaxation).toBe(70);
  });

  it('끊김은 경과 문구를 달고 값은 비운다', () => {
    const p = toHostParticipant(row({ last_eeg_at: isoAgo(130_000) }), { nowMs: NOW });
    expect(p.band).toBe('lost');
    expect(p.agoLabel).toBe('2분 전');
    expect(p.values.relaxation).toBeNull();
  });

  it('이름이 없으면 게스트/참가자로 표시한다', () => {
    expect(toHostParticipant(row({ display_name: '', is_guest: true }), { nowMs: NOW }).name).toBe('게스트');
    expect(toHostParticipant(row({ display_name: '', is_guest: false }), { nowMs: NOW }).name).toBe('참가자');
  });
});

describe('toHostQueue — 입장 대기자 명단', () => {
  const p = (over: Record<string, unknown>) => ({
    user_id: null, guest_name: null, is_guest: false, band_connected: false, linkband_device_id: null, webrtc_peer_id: null,
    consent_audio: false, consent_eeg: true, is_waitlisted: true, waitlist_position: 1, ...over,
  }) as Parameters<typeof toHostQueue>[0][number];

  it('대기열 참가자만 담고 id 는 participant_id 를 우선한다(게스트도 고유 id)', () => {
    const queue = toHostQueue([
      p({ participant_id: 'a1', is_waitlisted: false, user_name: '입장함' }),
      p({ participant_id: 'q1', user_id: 'u-q1', user_name: '가은' }),
      p({ participant_id: 'q2', guest_name: '게스트', is_guest: true }),
    ]);
    expect(queue).toEqual([{ id: 'q1', name: '가은' }, { id: 'q2', name: '게스트' }]);
  });

  it('participant_id 가 없으면 user_id, 그것도 없으면 순번으로 대체하고 이름이 없으면 "대기 회원"', () => {
    const queue = toHostQueue([p({ user_id: 'u-9', user_name: '민준' }), p({})]);
    expect(queue).toEqual([{ id: 'u-9', name: '민준' }, { id: 'queue-1', name: '대기 회원' }]);
  });
});
