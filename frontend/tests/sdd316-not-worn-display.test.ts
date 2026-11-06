// SDD-316: 코어가 reason=not_worn 으로 보낸 BPM·SDNN·호흡을 화면이 착용 안내로 해석한다(새 화면 없이 기존 칸 문구).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PID, SID, event, metricsData, snapshot } from './sdd246-web/fixtures';
import { applyEvent, applySnapshot, createLiveState } from '../src/lib/session-live/live-state';
import { liveMetricSnapshot, liveNotWorn, NOT_WORN_TEXT } from '../src/lib/session-live/live-metric-snapshot';

const NOW = 1_760_000_002_000;

function stateWith(notWorn: boolean) {
  const data = metricsData('42', 1_760_000_001_000, 60);
  for (const k of ['bpm', 'sdnn', 'respiration', 'rmssd']) {
    const m = data.metrics[k];
    if (m) data.metrics[k] = notWorn ? { ...m, value: null, validity: 'invalid', reason: 'not_worn' } : m;
  }
  const s0 = { ...createLiveState({ sessionId: SID }), expected: { requestId: snapshot().request_id, generation: '7' } };
  const st = applySnapshot(s0, snapshot()).state;
  return applyEvent(st, event('metrics', 'metrics.updated', '42', '4', data)).state;
}

describe('not_worn 표시', () => {
  it('문구는 금지 표현 없이 착용 안내', () => {
    expect(NOT_WORN_TEXT).toBe('밴드를 착용해 주세요');
    for (const bad of ['점수', '좋음', '나쁨', '완료', '보증', '100%']) expect(NOT_WORN_TEXT).not.toContain(bad);
  });
  it('liveNotWorn: 사유가 not_worn 이면 true, 아니면 false', () => {
    expect(liveNotWorn(stateWith(true) as never, PID)).toBe(true);
    expect(liveNotWorn(stateWith(false) as never, PID)).toBe(false);
    expect(liveNotWorn(null, PID)).toBe(false);
  });
  it('not_worn 이면 BPM·호흡·HRV 값은 null (0 치환 없음)', () => {
    const snap = liveMetricSnapshot(stateWith(true) as never, PID, NOW);
    expect(snap?.bpm ?? null).toBeNull();
    expect(snap?.respiration ?? null).toBeNull();
    expect(snap?.hrv ?? null).toBeNull();
  });
  it('MemberSheets 소스가 not_worn 일 때 착용 안내를 BPM·호흡·HRV 칸에만 쓴다', () => {
    const src = readFileSync('src/components/class/player/member/MemberSheets.tsx', 'utf8');
    expect(src).toContain('NOT_WORN_TEXT');
    expect(src).toMatch(/props\.notWorn && \(metric\.key === 'bpm' \|\| metric\.key === 'respiration' \|\| metric\.key === 'hrv'\)/);
  });
});
