// SDD-289 — 독 라벨은 온라인/오프라인 모두 '설정', 구역 제목만 미디어/녹음
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('상담사 독 설정 항목', () => {
  const src = readFileSync('src/components/class/player/host/HostLiveView.tsx', 'utf8');
  const caseSrc = readFileSync('src/lib/class/host-player-case.ts', 'utf8');
  it('독 항목이 설정 라벨·Settings 아이콘', () => {
    expect(src).toContain("label: hostCase.settingsDockLabel, icon: icon(Settings)");
    expect(caseSrc).toContain("settingsDockLabel: '설정'");
    expect(caseSrc).toContain("online ? '미디어 설정' : '녹음 설정'");
    expect(caseSrc).not.toContain('mediaDockLabel');
  });
  it('상단 status 카드에는 정원 늘리기 버튼이 없다', () => {
    const top = readFileSync('src/components/class/player/host/HostTopBar.tsx', 'utf8');
    expect(top).not.toMatch(/정원 늘리기|Capacity/);
  });
});
