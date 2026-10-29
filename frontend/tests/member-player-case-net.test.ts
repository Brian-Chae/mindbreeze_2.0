import { describe, expect, it } from 'vitest';
import { MEMBER_CASE_DEFAULT, deriveMemberCase } from '../src/lib/class/member-player-case';

describe('복귀 직후 연결 표시 (dev 사고: 서버만 끊겼는데 "연결 끊김")', () => {
  it('기기는 온라인인데 소켓만 끊김 → 서버 재연결 중 + serverOnly', () => {
    const c = deriveMemberCase({ ...MEMBER_CASE_DEFAULT, net: 'down', browserOnline: true });
    expect(c.conn.label).toBe('서버 재연결 중');
    expect(c.serverOnly).toBe(true);
    expect(c.netDown).toBe(true);
  });
  it('기기가 오프라인 → 기존 "연결 끊김"', () => {
    const c = deriveMemberCase({ ...MEMBER_CASE_DEFAULT, net: 'down', browserOnline: false });
    expect(c.conn.label).toBe('연결 끊김');
    expect(c.serverOnly).toBe(false);
  });
  it('정상 → 연결됨, browserOnline 생략 시에도 기존 동작 유지', () => {
    expect(deriveMemberCase({ ...MEMBER_CASE_DEFAULT, net: 'ok' }).conn.label).toBe('연결됨');
    expect(deriveMemberCase({ ...MEMBER_CASE_DEFAULT, net: 'reconnecting' }).conn.label).toBe('재연결 중');
  });
});
