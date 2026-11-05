// SDD-295 — 서버 확정 전에는 링에 "측정하는 중" 단정 문구를 쓰지 않는다.
import { describe, expect, it } from 'vitest';
import { deriveMemberCase, memberInput } from '../src/lib/class/member-player-case';

describe('SDD-295 링 대기 문구', () => {
  it('V1 서버 미확정이면 단정 문구가 없다', () => {
    const c = deriveMemberCase(memberInput({ band: 'on', serverConfirmed: false }));
    expect(c.ring.core).toBe('gauge');
    expect(c.ring.waitingText).toBe('연결 확인 중이에요');
    expect(c.ring.waitingText).not.toContain('측정하는 중');
  });
  it('V2 서버 확정이면 측정하는 중', () => {
    expect(deriveMemberCase(memberInput({ band: 'on', serverConfirmed: true })).ring.waitingText).toBe('측정하는 중이에요');
  });
  it('V3 미지정이면 기존 문구 유지', () => {
    expect(deriveMemberCase(memberInput({ band: 'on' })).ring.waitingText).toBe('측정하는 중이에요');
  });
  it('V4 다른 밴드 상태는 serverConfirmed 와 무관', () => {
    for (const band of ['off', 'pending', 'leadoff', 'lost'] as const) {
      const a = deriveMemberCase(memberInput({ band, serverConfirmed: false })).ring;
      const b = deriveMemberCase(memberInput({ band, serverConfirmed: true })).ring;
      expect(a).toEqual(b);
    }
  });
});
