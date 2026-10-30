// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyBandSkipUi, readBandSkip, shouldAutoConnectBand, writeBandSkip } from '../src/lib/class/flow/band-skip';
import { MEMBER_CASE_DEFAULT, deriveMemberCase } from '../src/lib/class/member-player-case';
import { decideMeasurementPath } from '../src/lib/measurement-web/measurement-path';

describe('밴드 없이 입장 (band-skip)', () => {
  beforeEach(() => window.localStorage.clear());

  it('선택은 회차 단위로 저장돼 재입장·새로고침 뒤에도 유지된다', () => {
    expect(readBandSkip('s1')).toBe(false);
    writeBandSkip('s1', true);
    expect(readBandSkip('s1')).toBe(true);
    expect(readBandSkip('s2')).toBe(false);
    writeBandSkip('s1', false);
    expect(readBandSkip('s1')).toBe(false);
  });

  it('밴드 없이 입장이면 자동 연결(스캔·재연결·네이티브 측정)을 하지 않는다', () => {
    expect(shouldAutoConnectBand('optional', true)).toBe(false);
    expect(shouldAutoConnectBand('required', true)).toBe(false);
    expect(shouldAutoConnectBand('optional', false)).toBe(true);
    expect(shouldAutoConnectBand('none', false)).toBe(false);
  });

  it('밴드 사용 해제 시 네이티브/웹 측정 경로가 꺼진다 (연결 호출 0회)', () => {
    const base = { v2: true, native: true, webBluetooth: true, bandConnected: false, eegConsent: true };
    expect(decideMeasurementPath({ ...base, bandOptIn: shouldAutoConnectBand('optional', true) })).toBe('off');
    expect(decideMeasurementPath({ ...base, bandOptIn: shouldAutoConnectBand('optional', false) })).toBe('native');
  });

  it("연결 중/끊김 표시는 'off' 로 바뀌어 '연결하는 중' 문구·대기 카드가 없다", () => {
    const ui = applyBandSkipUi('pending', true, false);
    expect(ui).toBe('off');
    const view = deriveMemberCase({ ...MEMBER_CASE_DEFAULT, band: ui });
    expect(JSON.stringify(view)).not.toContain('연결하는');
    expect(JSON.stringify(view)).not.toContain('오래 걸리면');
    expect(view.ring.title).toContain('밴드 없이');
  });

  it('선택을 안 했거나 한 번 연결된 적이 있으면 표시를 건드리지 않는다', () => {
    expect(applyBandSkipUi('pending', false, false)).toBe('pending');
    expect(applyBandSkipUi('lost', true, true)).toBe('lost');
    expect(applyBandSkipUi('on', true, false)).toBe('on');
  });
});
