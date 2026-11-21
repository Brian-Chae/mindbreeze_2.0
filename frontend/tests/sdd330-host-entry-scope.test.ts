// SDD-330 C: 코치 라이브 화면 — 입장자 기본 보기 · 입장/이상 요약
import { describe, expect, it } from 'vitest';
import {
  hasEntered,
  isAbnormal,
  scopeHostParticipants,
  summarizeHostEntry,
  type HostParticipant,
} from '../src/lib/class/host-player-case';

const NULLS = { focus: null, relaxation: null, emotional: null, bpm: null, respiration: null, hrv: null } as HostParticipant['values'];

function p(id: string, over: Partial<HostParticipant> = {}): HostParticipant {
  return { id, name: id, band: 'on', values: NULLS, lowBattery: false, hand: false, speaking: false, agoLabel: null, checkin: [], attention: null, presenceState: 'connected', enteredAt: '2026-11-21T10:00:00Z', ...over };
}

const never = p('never', { presenceState: 'unknown', enteredAt: null, band: 'off' });
const left = p('left', { presenceState: 'disconnected' });
const lost = p('lost', { band: 'lost' });
const lead = p('lead', { band: 'leadoff' });
const batt = p('batt', { lowBattery: true });
const noBand = p('noband', { band: 'off' });
const fine = p('fine');
const all = [never, left, lost, lead, batt, noBand, fine];

describe('SDD-330 입장자 기본 보기', () => {
  it('입장 시각이 있거나 접속 중이면 입장자, 둘 다 없으면 미입장', () => {
    expect(hasEntered(never)).toBe(false);
    expect(hasEntered(left)).toBe(true);
    expect(hasEntered(p('x', { enteredAt: null, presenceState: 'connected' }))).toBe(true);
  });

  it('기본은 미입장 제외, 전체 보기면 모두', () => {
    expect(scopeHostParticipants(all, { showAll: false, abnormalOnly: false }).map((x) => x.id)).not.toContain('never');
    expect(scopeHostParticipants(all, { showAll: true, abnormalOnly: false })).toHaveLength(7);
  });

  it('이상 = 끊김·접촉불량·배터리 부족·입장 후 미접속. 미착용·미입장은 아니다', () => {
    expect(all.filter(isAbnormal).map((x) => x.id)).toEqual(['left', 'lost', 'lead', 'batt']);
    expect(isAbnormal(never)).toBe(false);
    expect(isAbnormal(noBand)).toBe(false);
  });

  it('이상만 보기는 이상 회원만', () => {
    expect(scopeHostParticipants(all, { showAll: false, abnormalOnly: true }).map((x) => x.id)).toEqual(['left', 'lost', 'lead', 'batt']);
  });

  it('요약 숫자', () => {
    expect(summarizeHostEntry(all)).toEqual({ total: 7, entered: 6, abnormal: 4 });
  });
});
