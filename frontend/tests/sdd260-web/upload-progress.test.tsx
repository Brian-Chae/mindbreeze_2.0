// @vitest-environment jsdom
// SDD-260 UI — 네이티브 이벤트(feature.counts·archive.counts·reconcile.state) 수신 → 업로드 진행 표시 (V-C8)
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createUploadProgressStore, describeUploadProgress, type UploadProgress,
} from '../../src/lib/measurement-web/upload-progress';
import { UploadProgressNotice } from '../../src/lib/biosignal/upload-progress-notice';
import { NativeMeasurementFacade } from '../../src/lib/native-measurement';
import type { NativeMeasurementPlugin } from '../../src/lib/native-measurement/types';

const P = (o: Partial<UploadProgress> = {}): UploadProgress => ({
  featurePending: 0, featureAcked: 0, featureRejected: 0, rawPending: 0, rawUploading: 0, rawVerified: 0, rawQuarantined: 0,
  featureState: 'idle', rawState: 'idle', complete: false, ...o,
});

describe('describeUploadProgress', () => {
  it('대기가 있으면 전송 중 분석 데이터 N개 · 측정 기록 파일 M개(SDD-268 문구)', () => {
    expect(describeUploadProgress(P({ featurePending: 12, rawPending: 3, rawUploading: 1 }))).toEqual({
      kind: 'uploading', text: '전송 중 · 분석 데이터 12개 · 측정 기록 파일 4개',
    });
  });
  it('대기 0 이어도 summary 대조(complete)가 안 끝났으면 완료라 하지 않는다', () => {
    expect(describeUploadProgress(P({ featureAcked: 600 })).kind).toBe('checking');
  });
  it('complete=true 면 모두 도착(SDD-268 문구)', () => {
    expect(describeUploadProgress(P({ featureAcked: 600, complete: true }))).toEqual({ kind: 'done', text: '모두 도착했어요' });
  });
  it('격리(거절·quarantine)는 별도 안내로 센다', () => {
    expect(describeUploadProgress(P({ featureRejected: 2, rawQuarantined: 1, complete: true })).kind).toBe('needs_review');
  });
  it('아무 정보도 없으면 표시하지 않는다', () => {
    expect(describeUploadProgress(null)).toBeNull();
  });
});

describe('createUploadProgressStore', () => {
  it('부분 갱신을 합치고 구독자에게 알린다', () => {
    const s = createUploadProgressStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.update('s1', { featurePending: 5 });
    s.update('s1', { rawPending: 2 });
    expect(s.get('s1')).toMatchObject({ featurePending: 5, rawPending: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.update('s1', { featurePending: 0 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('세션별로 분리된다', () => {
    const s = createUploadProgressStore();
    s.update('a', { featurePending: 1 }); s.update('b', { featurePending: 9 });
    expect(s.get('a')?.featurePending).toBe(1);
    expect(s.get('b')?.featurePending).toBe(9);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function mount(progress: UploadProgress | null): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => { root.render(<UploadProgressNotice progress={progress} />); });
  return { host, root };
}

describe('UploadProgressNotice', () => {
  it('전송 중 문구와 모두 도착 문구를 그린다', async () => {
    const { host, root } = await mount(P({ featurePending: 7, rawPending: 1 }));
    expect(host.querySelector('[data-testid="upload-progress"]')?.textContent).toContain('분석 데이터 7개');
    await act(async () => { root.render(<UploadProgressNotice progress={P({ featureAcked: 7, complete: true })} />); });
    expect(host.querySelector('[data-testid="upload-progress"]')?.textContent).toContain('모두 도착했어요');
    act(() => root.unmount());
  });
  it('progress 가 없으면 아무것도 그리지 않는다', async () => {
    const { host, root } = await mount(null);
    expect(host.firstChild).toBeNull();
    act(() => root.unmount());
  });
});

describe('NativeMeasurementFacade — SDD-260 이벤트', () => {
  it('feature.counts · archive.counts · reconcile.state 를 업로드 진행 콜백으로 전달한다', async () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const plugin = {
      addListener: vi.fn(async (name: string, fn: (e: unknown) => void) => { handlers.set(name, fn); return { remove: async () => undefined }; }),
      getMeasurementSnapshot: vi.fn(async () => { throw Object.assign(new Error('not_active'), { code: 'not_active' }); }),
    } as unknown as NativeMeasurementPlugin;
    const facade = new NativeMeasurementFacade(plugin);
    const got: Array<Partial<UploadProgress>> = [];
    facade.onUploadProgress((p) => got.push(p));
    await facade.attach('s1');
    const base = { bridge_version: 1, managerGeneration: '1', emitted_at_native_ms: 0 };
    // 세대가 아직 없으면(측정 전) 그대로 전달한다
    handlers.get('feature.counts')?.({ ...base, seq: '1', event: 'feature.counts', payload: { sessionId: 's1', pending: 3, acked: 57, rejected: 1 } });
    handlers.get('archive.counts')?.({ ...base, seq: '2', event: 'archive.counts', payload: { sessionId: 's1', pending: 2, uploading: 1, verified: 10, quarantined: 0 } });
    handlers.get('reconcile.state')?.({ ...base, seq: '3', event: 'reconcile.state', payload: { sessionId: 's1', feature: 'resending', raw: 'idle', complete: false } });
    expect(got).toEqual([
      { featurePending: 3, featureAcked: 57, featureRejected: 1 },
      { rawPending: 2, rawUploading: 1, rawVerified: 10, rawQuarantined: 0 },
      { featureState: 'resending', rawState: 'idle', complete: false },
    ]);
  });
  it('다른 세션 이벤트는 무시한다', async () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const plugin = {
      addListener: vi.fn(async (name: string, fn: (e: unknown) => void) => { handlers.set(name, fn); return { remove: async () => undefined }; }),
      getMeasurementSnapshot: vi.fn(async () => { throw Object.assign(new Error('not_active'), { code: 'not_active' }); }),
    } as unknown as NativeMeasurementPlugin;
    const facade = new NativeMeasurementFacade(plugin);
    const cb = vi.fn();
    facade.onUploadProgress(cb);
    await facade.attach('s1');
    handlers.get('feature.counts')?.({ bridge_version: 1, managerGeneration: '1', seq: '1', emitted_at_native_ms: 0, event: 'feature.counts', payload: { sessionId: 'OTHER', pending: 1, acked: 0, rejected: 0 } });
    expect(cb).not.toHaveBeenCalled();
  });
});
