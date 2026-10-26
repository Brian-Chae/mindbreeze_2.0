import { describe, expect, it } from 'vitest';
import { HostSignalToastPolicy, type SignalSnapshot } from '../src/components/class/player/host/host-signal-toast';
const snapshot = (patch: Partial<SignalSnapshot> = {}): SignalSnapshot => ({ sessionId: 'a', connected: true, hands: [], queue: [], signals: {}, sheet: null, blocked: false, ...patch });
const policy = () => { const p = new HostSignalToastPolicy(); p.update(snapshot(), 0); return p; };
describe('상담사 즉시 신호 토스트 정책', () => {
  it('첫 수신 즉시 실명과 현재 대기·발언권을 표시하고 신규 ID만 합친다', () => {
    const p = policy();
    expect(p.update(snapshot({ hands: ['a'], handNames: { a: '지은' }, speakingCount: 2 }), 100)?.message).toBe('지은님이 손을 들었어요');
    const toast = p.update(snapshot({ hands: ['a', 'b', 'c'], handNames: { a: '지은' }, speakingCount: 2 }), 200);
    expect(toast?.message).toBe('지은 외 2명이 손을 들었어요');
    expect(toast?.detail).toBe('현재 대기 3명 · 발언권 2명');
    expect(p.update(snapshot({ hands: [] }), 300)).toBeNull();
  });
  it('6초 기본, 갱신 후 최소 3초, 최초 10초 상한을 적용한다', () => {
    const p = policy(); p.update(snapshot({ hands: ['a'] }), 100);
    expect(p.update(snapshot({ hands: ['a'] }), 6099)).not.toBeNull();
    p.update(snapshot({ hands: ['a', 'b'] }), 6100 - 1);
    expect(p.update(snapshot({ hands: ['a', 'b'] }), 9098)).not.toBeNull();
    p.update(snapshot({ hands: ['a', 'b', 'c'] }), 9098);
    expect(p.update(snapshot({ hands: ['a', 'b', 'c'] }), 10100)).toBeNull();
    expect(p.update(snapshot({ hands: ['a', 'b', 'c'] }), 10200)).toBeNull();
  });
  it('조용한 신호는 실명·전체 최신 집계, 4초 following, 쿨다운 없이 재표시한다', () => {
    const p = policy();
    const good = { a: { type: 'following' as const, at: 100, displayName: '서연' } };
    expect(p.update(snapshot({ signals: good }), 100)?.durationMs).toBe(4000);
    expect(p.update(snapshot({ signals: good }), 4100)).toBeNull();
    const hard = { a: { type: 'resting' as const, at: 4200, displayName: '서연' }, b: { type: 'difficult' as const, at: 4200 }, c: { type: 'difficult' as const, at: 4200 } };
    const toast = p.update(snapshot({ signals: hard }), 4200);
    expect(toast?.message).toContain('서연 · 잠시 쉴게요');
    expect(toast?.detail).toBe('전체: 어려워요 2 · 잠시 쉴게요 1');
  });
  it('세 주제를 즉시 병렬 표시하고 해당 행만 닫으며 같은 이벤트는 재표시하지 않는다', () => {
    const p = policy(); const state = snapshot({ hands: ['a'], queue: ['q'], signals: { s: { type: 'difficult', at: 100 } } });
    expect(p.update(state, 100)?.rows).toHaveLength(3);
    p.dismiss('hands');
    expect(p.update(state, 200)?.rows?.map((r) => r.topic)).toEqual(['signals', 'queue']);
    expect(p.update({ ...state, hands: ['a', 'b'] }, 300)?.rows).toHaveLength(3);
  });
  it('hover/focus 정지 후 최소 3초를 보장한다', () => {
    const p = policy(); const state = snapshot({ hands: ['a'] }); p.update(state, 100); p.pause(1000);
    expect(p.update(state, 20000)).not.toBeNull(); p.resume(20000);
    expect(p.update(state, 22999)).not.toBeNull(); expect(p.update(state, 25100)).toBeNull();
  });
  it('초기·재연결·세션 전환과 열린 같은 주제 시트는 새 알림을 만들지 않는다', () => {
    const p = new HostSignalToastPolicy(); expect(p.update(snapshot({ hands: ['a'] }), 0)).toBeNull();
    p.update(snapshot({ connected: false }), 100); expect(p.update(snapshot({ hands: ['b'] }), 200)).toBeNull();
    expect(p.update(snapshot({ sessionId: 'b', hands: ['c'] }), 300)).toBeNull();
    expect(p.update(snapshot({ sessionId: 'b', hands: ['c', 'd'], sheet: 'hands' }), 400)).toBeNull();
  });
  it('기본 6초 경계와 만료 후 새 이벤트를 즉시 처리하고 이름 누락은 참가자로 표시한다', () => {
    const p = policy(); const state = snapshot({ hands: ['private-id'], handNames: { 'private-id': '익명' } });
    expect(p.update(state, 100)?.message).toBe('참가자님이 손을 들었어요');
    expect(p.update(state, 6100)).toBeNull();
    expect(p.update({ ...state, hands: ['private-id', 'new'] }, 6200)).not.toBeNull();
    expect(JSON.stringify(p.update({ ...state, hands: ['private-id', 'new'] }, 6300))).not.toContain('private-id');
  });
  it('TTL와 손내림으로 해소된 신규 대상은 즉시 제거하고 역순 신호는 재노출하지 않는다', () => {
    const p = policy();
    const state = snapshot({ hands: ['a', 'b'], handNames: { a: '지은', b: '민수' } });
    p.update(state, 100);
    expect(p.update({ ...state, hands: ['b'] }, 200)?.message).toBe('민수님이 손을 들었어요');
    p.dismiss();
    p.update(snapshot({ signals: { a: { type: 'difficult', at: 1000 } } }), 1000); p.dismiss();
    expect(p.update(snapshot({ signals: { a: { type: 'difficult', at: 900 } } }), 1100)).toBeNull();
    expect(p.update(snapshot(), 11000)).toBeNull();
  });

  it('following에서 어려움으로 바뀌면 기본 6초로 승격한다', () => {
    const p = policy(); p.update(snapshot({ signals: { a: { type: 'following', at: 100 } } }), 100);
    const hard = snapshot({ signals: { a: { type: 'difficult', at: 200 } } });
    expect(p.update(hard, 200)?.durationMs).toBe(6000);
    expect(p.update(hard, 6099)).not.toBeNull(); expect(p.update(hard, 6100)).toBeNull();
  });
  it('10초 상한 다음 새 이벤트만 새 주기로 만들고 가려진 동안 이벤트는 재생하지 않는다', () => {
    const p = policy(); let state = snapshot({ hands: ['a'] }); p.update(state, 100);
    for (const at of [5000, 7000, 9000]) { state = { ...state, hands: [...state.hands, String(at)] }; p.update(state, at); }
    expect(p.update(state, 10100)).toBeNull();
    expect(p.update({ ...state, hands: [...state.hands, 'new'] }, 10101)).not.toBeNull();
    const q = policy(); const blocked = snapshot({ hands: ['a'], blocked: true });
    expect(q.update(blocked, 100)).toBeNull(); expect(q.update({ ...blocked, blocked: false }, 200)).toBeNull();
  });
  it('시트가 열린 같은 주제 이벤트를 소비하며 서로 다른 주제는 즉시 보인다', () => {
    const p = policy(); const state = snapshot({ sheet: 'hands', hands: ['a'], queue: ['b'] });
    expect(p.update(state, 100)?.rows?.map((row) => row.topic)).toEqual(['queue']);
    expect(p.update({ ...state, sheet: null }, 200)?.rows?.map((row) => row.topic)).toEqual(['queue']);
  });

  it('정지한 마지막 행을 닫거나 해소해도 다음 알림 타이머는 정상 만료한다', () => {
    for (const dismiss of [true, false]) {
      const p = policy(); p.update(snapshot({ hands: ['a'] }), 100); p.pause(200);
      if (dismiss) p.dismiss('hands'); else p.update(snapshot(), 300);
      const next = snapshot({ hands: ['b'] });
      expect(p.update(next, 400)).not.toBeNull();
      expect(p.update(next, 6400)).toBeNull();
    }
  });

});
