// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MeasurementDetail } from '../src/components/data-center/measurement-detail';
import detail from '../../specs/sdd-243-platform-data-center/contracts/fixtures/measurement-detail.json';
import spectrum from '../../specs/sdd-243-platform-data-center/contracts/fixtures/spectrum.json';
import waveform from '../../specs/sdd-243-platform-data-center/contracts/fixtures/waveform.json';
import features from '../../specs/sdd-243-platform-data-center/contracts/fixtures/features.json';
import indices from '../../specs/sdd-243-platform-data-center/contracts/fixtures/indices.json';
import { waveformSeries, SignalWaveform } from '../src/components/data-center/signal-waveform';
import { FeatureTable } from '../src/components/data-center/feature-table';
import { IndicesChart } from '../src/components/data-center/indices-chart';
import { measurementApi, type WaveformResponse, type IndicesPage } from '../src/lib/api/data-center-measurement';
import { apiClient } from '../src/lib/api/client';
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, LineChart: ({children}: {children:React.ReactNode}) => <div>{children}</div>, Line: () => null, XAxis: ({type}: {type?:string}) => <span data-axis-type={type}/>, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null }));
describe('SDD243 측정', () => {
 it('segment 경계를 독립 시리즈로 분리하고 null을 유지한다', () => {
  const result = waveformSeries(waveform as WaveformResponse, waveform.channels[0]);
  expect(result).toHaveLength(2);
  expect(result[0]).toHaveLength(2);
  expect(result[1][0].min).toBeNull();
 });
 it('샘플 사이에 있는 gap도 null 절단점으로 처리한다', () => {
  const raw = { ...waveform, t_us:['0','9000000'], segments:[{ stream_id:'s',segment_id:'a',point_start:0,point_end:2 }] } as WaveformResponse;
  const result = waveformSeries(raw, { name:'fp1',unit:'uV',values:[10,20],min:null,max:null });
  expect(result[0]).toHaveLength(3);
  expect(result[0][1].value).toBeNull();
  expect(result[0][2].value).toBe(20);
 });
 it('미수집을 0파형으로 바꾸지 않는다', () => {
  const html = renderToStaticMarkup(<SignalWaveform data={{ ...waveform, availability: 'not_collected', unavailable_reason: 'band_not_used' } as WaveformResponse} />);
  expect(html).toContain('미수집');
  expect(html).not.toContain('<svg');
 });
 it('원 feature 소수와 null을 보존한다', () => {
  const html = renderToStaticMarkup(<FeatureTable data={features} />);
  expect(html).toContain('1.234567890123');
  expect(html).toContain('값 없음');
 });
 it('HRV를 SDNN으로 표기하고 출처와 모델을 표시한다', () => {
  const html = renderToStaticMarkup(<IndicesChart data={indices as IndicesPage} />);
  expect(html).toContain('HRV SDNN · ms');
  expect(html).toContain('participant_player');
  expect(html).toContain('display-model-1');
 });
 it('B04 endpoint에 범위와 기관 및 취소 신호를 전달한다', async () => {
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue(waveform);
  const controller = new AbortController();
  await measurementApi.waveform('s', 'p', { fromUs: '0', toUs: '30000000' }, 'acc', 'o', controller.signal);
  expect(get).toHaveBeenCalledWith(expect.stringContaining('/data-center/measurements/s/p/waveform?'), { signal: controller.signal });
  expect(get.mock.calls[0][0]).toContain('signal_type=acc');
  expect(get.mock.calls[0][0]).toContain('org_id=o');
  expect(get.mock.calls[0][0]).toContain('to_us=30000000');
  get.mockRestore();
 });
});

Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT:true });
afterEach(()=>vi.restoreAllMocks());
describe('측정 선택과 요청 수명',()=>{
 function mockApis() {
  vi.spyOn(apiClient,'get').mockResolvedValue(detail);
  vi.spyOn(measurementApi,'features').mockResolvedValue(features);
  vi.spyOn(measurementApi,'indices').mockResolvedValue(indices as IndicesPage);
  vi.spyOn(measurementApi,'spectrum').mockResolvedValue(spectrum);
  return vi.spyOn(measurementApi,'waveform').mockResolvedValue(waveform as WaveformResponse);
 }
 it('10/30/60초 범위를 파형/feature/PSD가 공유한다', async()=>{
  const wave=mockApis(); const element=document.createElement('div'); const root=createRoot(element);
  await act(async()=>{root.render(<MeasurementDetail sessionId="s" participantId="p"/>);});
  expect(element.textContent).toContain('참여자 P01');
  expect(element.textContent).toContain('뇌파 수집 동의');
  expect(element.textContent).toContain('분석 값 900');
  for(const value of ['30','60']) {
   await act(async()=>{const select=element.querySelector('select')!;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});
   expect(wave.mock.calls.at(-1)?.[2]).toEqual({fromUs:'0',toUs:`${value}000000`});
   expect(vi.mocked(measurementApi.features).mock.calls.at(-1)?.[2]).toEqual({fromUs:'0',toUs:`${value}000000`});
   expect(vi.mocked(measurementApi.spectrum).mock.calls.at(-1)?.[2]).toEqual({fromUs:'0',toUs:`${value}000000`});
  }
  await act(async()=>root.unmount());
 });
 it('측정 변경 시 취소하고 늦은 이전 응답은 폐기한다', async()=>{
  const wave=mockApis(); let resolveOld!:(value:WaveformResponse)=>void;
  wave.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  const element=document.createElement('div'); const root=createRoot(element);
  await act(async()=>{root.render(<MeasurementDetail sessionId="old" participantId="p"/>);});
  const signal=wave.mock.calls[0][5];
  await act(async()=>{root.render(<MeasurementDetail sessionId="new" participantId="p"/>);});
  expect(signal?.aborted).toBe(true);
  await act(async()=>resolveOld({...waveform,availability:'not_collected',unavailable_reason:'OLD_SECRET_BUFFER'} as WaveformResponse));
  expect(element.textContent).not.toContain('OLD_SECRET_BUFFER');
  expect(element.textContent).toContain('fp1');
  await act(async()=>root.unmount());
 });
 it('선택 범위 밖 당시 지표는 화면에 섞지 않는다',()=>{
  const html=renderToStaticMarkup(<IndicesChart data={indices as IndicesPage} selection={{fromUs:'1000000',toUs:'10000000'}}/>);
  expect(html).not.toContain('display-model-1');
  expect(html).toContain('미수집');
 });
});

it('지표 시간축은 숫자 축이며 전부 null인 지표는 사유를 펼치지 않아도 보여준다',()=>{
 const html=renderToStaticMarkup(<IndicesChart data={indices as IndicesPage} selection={{fromUs:'0',toUs:'10000000'}}/>);
 expect(html).toContain('data-axis-type="number"');
 expect(html).toContain('dc-index-unavailable');
});

it.each([
 ['ppg',['red','ir'],'count',50],
 ['acc',['x','y','z'],'g',25],
] as const)('%s 수집 원파형은 모든 채널과 원 단위/샘플링률을 보존한다',(signal,names,unit,rate)=>{
 const data={...waveform,signal_type:signal,method:'raw' as const,nominal_rate_hz:rate,channels:names.map(name=>({name,unit,values:[-1,2,null],min:null,max:null}))} as WaveformResponse;
 const html=renderToStaticMarkup(<SignalWaveform data={data}/>);
 for(const channel of data.channels) {
  expect(html).toContain(`${channel.name} · ${unit}`);
  expect(waveformSeries(data,channel)[0].map(point=>point.value)).toEqual([-1,2]);
 }
 expect(html).toContain(`${rate} Hz`);
 expect(html).toContain('원본 해상도');
});
