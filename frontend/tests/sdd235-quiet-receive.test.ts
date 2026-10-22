import { expect, it } from 'vitest';
import { receiveSignal } from '../src/lib/class/quiet-signal';
it('서버 시각 중복과 과거 이벤트는 집계 TTL이나 신호 종류를 바꾸지 않는다', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const first = receiveSignal({}, 'p1', 'following', new Date(now).toISOString(), now);
  expect(receiveSignal(first, 'p1', 'following', new Date(now).toISOString(), now + 1000)).toBe(first);
  const changed = receiveSignal(first, 'p1', 'difficult', new Date(now + 500).toISOString(), now + 500);
  expect(receiveSignal(changed, 'p1', 'following', new Date(now).toISOString(), now + 1500)).toBe(changed);
  expect(receiveSignal({}, 'p1', 'resting', new Date(now - 11000).toISOString(), now)).toEqual({});
});
it('서버 시각 없는 구 payload는 500ms 중복 억제 후 새 수신을 허용한다', () => {
  const first = receiveSignal({}, 'p1', 'following', null, 1000);
  expect(receiveSignal(first, 'p1', 'following', null, 1200)).toBe(first);
  expect(receiveSignal(first, 'p1', 'difficult', null, 1200).p1.type).toBe('difficult');
  expect(receiveSignal(first, 'p1', 'following', null, 1600).p1.at).toBe(1600);
});
