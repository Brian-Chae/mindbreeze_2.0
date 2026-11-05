// SDD-289 → SDD-299 — 독 라벨: 온라인 분석·채팅·미디어·설정 / 오프라인 분석·채팅·녹음·설정
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hostDockLabels } from '../src/lib/class/host-player-case';

describe('상담사 독 재편성(SDD-299)', () => {
  const src = readFileSync('src/components/class/player/host/HostLiveView.tsx', 'utf8');
  it('온라인 독 라벨 4개', () => {
    expect(Object.values(hostDockLabels(true))).toEqual(['분석', '채팅', '미디어', '설정']);
  });
  it('오프라인 독 라벨 4개', () => {
    expect(Object.values(hostDockLabels(false))).toEqual(['분석', '채팅', '녹음', '설정']);
  });
  it('독은 라벨 상수를 쓰고 구 라벨(지표 기준·도구)을 하드코딩하지 않는다', () => {
    expect(src).toContain('hostCase.dockLabels.metric');
    expect(src).toContain('hostCase.dockLabels.media');
    expect(src).toContain('hostCase.dockLabels.tools');
    expect(src).not.toMatch(/'지표 기준'|'도구'/);
  });
  it('상단 status 카드에는 정원 늘리기 버튼이 없다', () => {
    const top = readFileSync('src/components/class/player/host/HostTopBar.tsx', 'utf8');
    expect(top).not.toMatch(/정원 늘리기|Capacity/);
  });
});
