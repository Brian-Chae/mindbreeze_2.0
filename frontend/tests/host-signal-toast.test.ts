import { describe, expect, it } from 'vitest';
import { HostSignalToastPolicy, type SignalSnapshot } from '../src/components/class/player/host/host-signal-toast';
const snapshot = (patch: Partial<SignalSnapshot> = {}): SignalSnapshot => ({ sessionId: 'a', connected: true, hands: [], queue: [], signals: {}, sheet: null, blocked: false, ...patch });
describe('상담사 무음 신호 토스트 정책', () => {
  it('초기·중복 상태를 무시하고 2초 동안 새 손들기를 묶는다', () => {
    const p = new HostSignalToastPolicy();
    p.update(snapshot(), 0);
    expect(p.update(snapshot({ hands: ['a'] }), 100)).toBeNull();
    p.update(snapshot({ hands: ['a', 'b'] }), 500);
    expect(p.update(snapshot({ hands: ['a', 'b'] }), 2100)?.message).toBe('새 손들기 2명 · 대기 2명');
    expect(p.update(snapshot({ hands: ['a', 'b'] }), 8200)).toBeNull();
  });
  it('조용한 신호는 같은 총합의 종류 변경도 감지하고 식별자를 노출하지 않는다', () => {
    const p = new HostSignalToastPolicy();
    p.update(snapshot({ signals: { secret: { type: 'following', at: 0 } } }), 0);
    p.update(snapshot({ signals: { secret: { type: 'difficult', at: 100 } } }), 100);
    const toast = p.update(snapshot({ signals: { secret: { type: 'difficult', at: 100 } } }), 2100);
    expect(toast?.message).toContain('조금 어려워요 1');
    expect(JSON.stringify(toast)).not.toContain('secret');
    expect(toast?.durationMs).toBe(6000);
    expect(p.update(snapshot(), 10100)).toBeNull();
  });
  it('좋은 신호만 있으면 4초, 같은 시트·해소된 요청은 억제한다', () => {
    const p = new HostSignalToastPolicy(); p.update(snapshot(), 0);
    p.update(snapshot({ signals: { a: { type: 'following', at: 100 } } }), 100);
    expect(p.update(snapshot({ signals: { a: { type: 'following', at: 100 } } }), 2100)?.durationMs).toBe(4000);
    expect(p.update(snapshot({ sheet: 'signals' }), 2200)).toBeNull();
    p.update(snapshot({ hands: ['a'] }), 2300);
    expect(p.update(snapshot(), 4400)).toBeNull();
  });
  it('재연결·세션 변경은 기존 상태를 새 알림으로 만들지 않는다', () => {
    const p = new HostSignalToastPolicy(); p.update(snapshot(), 0);
    p.update(snapshot({ connected: false }), 100);
    p.update(snapshot({ hands: ['a'] }), 200);
    expect(p.update(snapshot({ hands: ['a'] }), 3000)).toBeNull();
    expect(p.update(snapshot({ sessionId: 'b', hands: ['b'] }), 6000)).toBeNull();
  });
  it('표시 중 조용한 신호 종류 변경을 한 카드로 병합하고 시간을 무한 연장하지 않는다', () => {
    const p = new HostSignalToastPolicy(); p.update(snapshot(), 0);
    const good = { a: { type: 'following' as const, at: 100 } };
    p.update(snapshot({ signals: good }), 100);
    p.update(snapshot({ signals: good }), 2100);
    const hard = { a: { type: 'difficult' as const, at: 2200 } };
    expect(p.update(snapshot({ signals: hard }), 2200)?.message).toContain('조금 어려워요 1');
    expect(p.update(snapshot({ signals: hard }), 8100)).toBeNull();
  });
  it('입장 대기를 3초 묶고 한 장만 표시한다', () => {
    const p = new HostSignalToastPolicy(); p.update(snapshot(), 0);
    p.update(snapshot({ queue: ['a'] }), 100);
    expect(p.update(snapshot({ queue: ['a'] }), 3099)).toBeNull();
    expect(p.update(snapshot({ queue: ['a'] }), 3100)?.topic).toBe('queue');
  });
});
