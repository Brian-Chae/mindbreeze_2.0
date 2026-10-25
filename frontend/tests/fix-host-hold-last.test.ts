import { describe, expect, it } from 'vitest';
import { HOLD_LAST_VALUE_MS, holdLastValues } from '../src/components/class/player/host/host-live-model';
import { EMPTY_HOST_VALUES, type HostParticipant } from '../src/lib/class/host-player-case';

const mk = (band: HostParticipant['band'], values: Partial<HostParticipant['values']>): HostParticipant => ({
  id: 'p1', name: 'n', band, values: { ...EMPTY_HOST_VALUES, ...values }, lowBattery: false, hand: false, speaking: false,
  agoLabel: null, checkin: [], attention: null,
});

describe('상담사 화면 지표 직전 값 유지', () => {
  it('일시 null 이면 15초 이내 직전 값을 유지한다', () => {
    const a = holdLastValues([mk('on', { respiration: 14, hrv: 40 })], {}, 1000);
    const b = holdLastValues([mk('on', { respiration: null, hrv: null })], a.held, 1000 + 4000);
    expect(b.participants[0].values.respiration).toBe(14);
    expect(b.participants[0].values.hrv).toBe(40);
  });
  it('15초를 넘기면 null 로 돌아간다', () => {
    const a = holdLastValues([mk('on', { respiration: 14 })], {}, 0);
    const b = holdLastValues([mk('on', { respiration: null })], a.held, HOLD_LAST_VALUE_MS + 1);
    expect(b.participants[0].values.respiration).toBeNull();
  });
  it('새 값이 오면 갱신하고 유지 시각도 늘어난다', () => {
    const a = holdLastValues([mk('on', { respiration: 14 })], {}, 0);
    const b = holdLastValues([mk('on', { respiration: 16 })], a.held, 10_000);
    const c = holdLastValues([mk('on', { respiration: null })], b.held, 20_000);
    expect(c.participants[0].values.respiration).toBe(16);
  });
  it('band 가 on 이 아니면 유지하지 않고 보관분도 버린다', () => {
    const a = holdLastValues([mk('on', { respiration: 14 })], {}, 0);
    const b = holdLastValues([mk('lost', {})], a.held, 1000);
    expect(b.participants[0].values.respiration).toBeNull();
    expect(b.held.p1).toBeUndefined();
    const c = holdLastValues([mk('on', {})], b.held, 2000);
    expect(c.participants[0].values.respiration).toBeNull();
  });
  it('입력을 변경하지 않는다', () => {
    const input = [mk('on', { respiration: null })];
    const a = holdLastValues([mk('on', { respiration: 14 })], {}, 0);
    holdLastValues(input, a.held, 1000);
    expect(input[0].values.respiration).toBeNull();
  });
});
