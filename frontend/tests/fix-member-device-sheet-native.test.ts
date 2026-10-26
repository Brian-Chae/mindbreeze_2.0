// 앱 회원 기기 메뉴: 네이티브 측정 중 신호·접촉·원시 파형.
import { describe, expect, it, vi } from 'vitest';
import { NativeMeasurementFacade } from '../src/lib/native-measurement';
import { toNativeDevice } from '../src/lib/native-measurement/device-status';
import type { MeasurementSnapshot, NativeMeasurementPlugin } from '../src/lib/native-measurement/types';
import { centerSeries } from '../src/components/class/player/member/member-metrics';

const snap = (sqi: number | null, fp1: string, fp2: string, band: string): MeasurementSnapshot => ({
  metrics: { sequence: '1', observed_at_ms: 1, freshness: 'fresh', sqi, contact: { fp1, fp2 }, metrics: {} },
  collection: { band_state: band },
} as never);

describe('toNativeDevice', () => {
  it('sqi → 레벨', () => {
    expect(toNativeDevice(snap(0.8, 'contact', 'contact', 'connected')).signalQualityLevel).toBe('ok');
    expect(toNativeDevice(snap(0.5, 'contact', 'contact', 'connected')).signalQualityLevel).toBe('degraded');
    expect(toNativeDevice(snap(0.1, 'contact', 'contact', 'connected')).signalQualityLevel).toBe('invalid');
    expect(toNativeDevice(snap(null, 'contact', 'contact', 'connected')).signalQualityLevel).toBe('unknown');
  });
  it('접촉', () => {
    expect(toNativeDevice(snap(0.8, 'contact', 'contact', 'connected')).deviceStatus).toBe('ok');
    expect(toNativeDevice(snap(0.8, 'leadoff', 'contact', 'connected')).deviceStatus).toBe('lead_off');
    expect(toNativeDevice(snap(0.8, 'unknown', 'unknown', 'connected')).deviceStatus).toBe('unknown');
    expect(toNativeDevice(snap(0.8, 'contact', 'unknown', 'connected')).deviceStatus).toBe('unknown');
  });
  it('밴드 상태', () => {
    expect(toNativeDevice(snap(0.8, 'contact', 'contact', 'connected')).connected).toBe(true);
    expect(toNativeDevice(snap(0.8, 'contact', 'contact', 'reconnecting')).connected).toBe(false);
    expect(toNativeDevice(snap(0.8, 'contact', 'contact', 'connecting')).connected).toBe(false);
  });
  it('metrics 없음 → unknown, 연결은 band_state 로', () => {
    const d = toNativeDevice({ metrics: null, collection: { band_state: 'connected' } } as never);
    expect(d.signalQualityLevel).toBe('unknown');
    expect(d.deviceStatus).toBe('unknown');
  });
});

describe('facade.getRawPreview', () => {
  const mk = (impl?: () => Promise<unknown>) => {
    const p = { getRawPreview: impl ? vi.fn(impl) : undefined } as unknown as NativeMeasurementPlugin;
    return { p, f: new NativeMeasurementFacade(p) };
  };
  const good = { eegFp1: [1, 2], eegFp2: [3, 4], ppgRed: [5, 6], ppgIr: [7, 8] };
  it('android 만 호출', async () => {
    const { p, f } = mk(async () => good);
    expect(await f.getRawPreview('android')).toEqual(good);
    expect(await f.getRawPreview('ios')).toBeNull();
    expect(await f.getRawPreview('web')).toBeNull();
    expect((p.getRawPreview as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
  it('reject(UNIMPLEMENTED)·형식 불일치 → null', async () => {
    expect(await mk(async () => { throw new Error('UNIMPLEMENTED'); }).f.getRawPreview('android')).toBeNull();
    expect(await mk(async () => ({ eegFp1: 'x' })).f.getRawPreview('android')).toBeNull();
  });
});

describe('centerSeries', () => {
  it('DC 오프셋 제거', () => {
    const out = centerSeries([100000, 100002, 99998, 100000]);
    expect(Math.max(...out)).toBeCloseTo(2);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
  });
  it('빈 배열', () => expect(centerSeries([])).toEqual([]));
});
