import { expect, it } from 'vitest';
import { pruneSignals, receiveSignal } from '../src/lib/class/quiet-signal';
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

it('이름은 메모리에 보존하고 미확인 이름은 참가자로 정규화한다', () => {
  const signal = receiveSignal({}, 'private-id', 'resting', null, 1000, ' 서연 ');
  expect(signal['private-id'].displayName).toBe('서연');
  expect(receiveSignal({}, 'p2', 'following', null, 1000, '익명').p2.displayName).toBe('참가자');
  expect(receiveSignal({}, 'p3', 'following', null, 1000).p3.displayName).toBe('참가자');
});

it('중복 전송은 이름과 TTL을 바꾸지 않고 만료 시 이름도 함께 제거한다', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const first = receiveSignal({}, 'p1', 'resting', new Date(now).toISOString(), now, '서연');
  expect(receiveSignal(first, 'p1', 'resting', new Date(now).toISOString(), now + 1000, '다른 이름')).toBe(first);
  expect(pruneSignals(first, now + 9999).p1.displayName).toBe('서연');
  expect(pruneSignals(first, now + 10000)).toEqual({});
});
