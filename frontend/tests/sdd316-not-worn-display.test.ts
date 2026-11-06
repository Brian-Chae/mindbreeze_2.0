// SDD-316: 코어가 reason=not_worn 으로 보낸 BPM·SDNN·호흡을 화면이 착용 안내로 해석한다(새 화면 없이 기존 칸 문구).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PID, SID, event, metricsData, snapshot } from './sdd246-web/fixtures';
import { applyEvent, applySnapshot, createLiveState } from '../src/lib/session-live/live-state';
import { liveMetricSnapshot, liveNotWorn } from '../src/lib/session-live/live-metric-snapshot';

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
  it('11/6 대표 지시: 미착용 안내 문구를 화면에 쓰지 않는다', () => {
    for (const f of ['MemberSheets.tsx', 'MemberStage.tsx']) {
      const src = readFileSync('src/components/class/player/member/' + f, 'utf8');
      expect(src).not.toContain('NOT_WORN_TEXT');
      expect(src).not.toContain('밴드를 착용해 주세요');
    }
  });
});
