// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { vi } from 'vitest';
import detail from '../../specs/sdd-243-platform-data-center/contracts/fixtures/measurement-detail.json';
import waveform from '../../specs/sdd-243-platform-data-center/contracts/fixtures/waveform.json';
import { SignalWaveform, gapLine } from '../src/components/data-center/signal-waveform';
import type { WaveformResponse } from '../src/lib/api/data-center-measurement';

vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, LineChart: ({children}: {children:React.ReactNode}) => <div>{children}</div>, Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null }));

const BANNED = /점수|좋음|나쁨|완료|보증|feature|원시|PPG|ACC/;
describe('SDD269 결측 구간 표시', () => {
 it('V-F01 파생 구간은 소수 1자리와 안내 문구로 표시한다', () => {
  expect(gapLine({ start_us: '22000000', end_us: '32730000', reason: 'unknown', source: 'derived' })).toBe('22.0–32.7초 · 10.7초 결측 · 원인 미확인 (저장 데이터로 계산)');
  expect(gapLine({ start_us: '5000000', end_us: '8000000', reason: 'signal_lost', source: 'derived' })).toContain('신호 끊김');
  expect(gapLine({ start_us: '1000000', end_us: '4000000', reason: 'ble_disconnect', source: 'recorded' })).not.toContain('저장 데이터로 계산');
 });
 it('파형 결측 블록에 파생 구간이 보이고 금지어가 없다', () => {
  const data = { ...waveform, gaps: [{ start_us: '5000000', end_us: '8000000', reason: 'signal_lost', source: 'derived' }] } as WaveformResponse;
  const html = renderToStaticMarkup(<SignalWaveform data={data} />);
  expect(html).toContain('5.0–8.0초 · 3.0초 결측');
  const gapPart = html.slice(html.indexOf('결측 구간'));
  expect(BANNED.test(gapLine(data.gaps[0]))).toBe(false);
  expect(gapPart).toContain('선으로 연결하지 않음');
 });
 it('source 없는 기존 응답도 그대로 표시한다', () => {
  expect(gapLine({ start_us: '0', end_us: '2000000', reason: 'sample_index_gap' })).toBe('0.0–2.0초 · 2.0초 결측 · sample_index_gap');
 });
});

import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MeasurementDetail } from '../src/components/data-center/measurement-detail';
import { measurementApi } from '../src/lib/api/data-center-measurement';
import { apiClient } from '../src/lib/api/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('SDD269 회차 상세 요약', () => {
 it('V-F02 구간이 있으면 중립 문구를 보여준다', async () => {
  const el = document.createElement('div'); const root = createRoot(el);
  vi.spyOn(apiClient, 'get').mockResolvedValue(detail);
  vi.spyOn(measurementApi, 'waveform').mockResolvedValue(waveform as WaveformResponse);
  vi.spyOn(measurementApi, 'features').mockResolvedValue({ items: [], next_cursor: null, total: 0 } as never);
  vi.spyOn(measurementApi, 'indices').mockResolvedValue({ items: [], next_cursor: null, note: null } as never);
  vi.spyOn(measurementApi, 'spectrum').mockResolvedValue({ computable: false, reason: 'x', method: 'welch', unit: '', freq_hz: [], channels: [], window_sec: 0, overlap: 0 } as never);
  vi.spyOn(measurementApi, 'gaps').mockResolvedValue({ gaps: [], count: 4, total_seconds: 22.7 });
  await act(async () => { root.render(<MeasurementDetail sessionId="s" participantId="p" />); });
  expect(el.textContent).toContain('측정 중 신호가 끊긴 구간 4회, 합계 22.7초');
  await act(async () => root.unmount());
 });
 it('V-F02 0회면 숨긴다', async () => {
  const el = document.createElement('div'); const root = createRoot(el);
  vi.spyOn(measurementApi, 'gaps').mockResolvedValue({ gaps: [], count: 0, total_seconds: 0 });
  await act(async () => { root.render(<MeasurementDetail sessionId="s" participantId="p" />); });
  expect(el.textContent).not.toContain('신호가 끊긴 구간');
  await act(async () => root.unmount());
 });
});

afterEach(() => vi.restoreAllMocks());
