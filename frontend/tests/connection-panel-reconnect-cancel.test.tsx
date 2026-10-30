// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionPanel } from '../src/components/playground/ConnectionPanel';
import type { UseBandResult } from '../src/hooks/useBand';

function makeBand(patch: Partial<UseBandResult>): UseBandResult {
  return {
    isSupported: true,
    isMock: false,
    connectionState: 'disconnected',
    isReconnecting: false,
    battery: null,
    signalQuality: null,
    signalQualityLevel: 'unknown',
    sensors: { leftElectrode: 'loading', rightElectrode: 'loading', ppgSensor: 'loading', signalQuality: 'loading' },
    connectedElapsedSec: 0,
    error: null,
    connect: async () => undefined,
    disconnect: async () => undefined,
    clearBuffers: () => undefined,
    ...patch,
  } as unknown as UseBandResult;
}

const render = (band: UseBandResult) =>
  renderToStaticMarkup(<ConnectionPanel band={band} useMock={band.isMock} onToggleMock={() => undefined} />);

describe('플레이그라운드 밴드 재연결 취소', () => {
  it('자동 재연결 중에는 재연결 취소 버튼이 노출된다', () => {
    expect(render(makeBand({ isReconnecting: true }))).toContain('재연결 취소');
  });

  it('연결 시도 중(connecting)에도 연결 취소 버튼이 노출된다', () => {
    expect(render(makeBand({ connectionState: 'connecting' }))).toContain('연결 취소');
  });

  it('평상시(미연결)에는 취소 버튼이 없다', () => {
    const html = render(makeBand({}));
    expect(html).not.toContain('재연결 취소');
    expect(html).not.toContain('연결 취소');
  });

  it('재연결 중 연결 버튼은 비활성이 아니고 다시 연결로 표시된다', () => {
    const html = render(makeBand({ isReconnecting: true }));
    expect(html).toContain('다시 연결');
  });
});
