import { useEffect, useRef, useState } from 'react';
import { measurementApi, type FeaturePage, type IndicesPage, type MeasurementSelection, type SignalType, type SpectrumResponse, type WaveformResponse } from '../../lib/api/data-center-measurement';
import { SignalWaveform } from './signal-waveform';
import { FeatureTable } from './feature-table';
import { IndicesChart } from './indices-chart';
import { SpectrumPanel } from './spectrum-panel';
import './measurement-detail.css';
export interface MeasurementDetailProps { sessionId: string; participantId: string; orgId?: string; onClose?: () => void; onSelectionChange?: (selection: MeasurementSelection) => void }
interface DetailData { waveform: WaveformResponse | null; features: FeaturePage | null; indices: IndicesPage | null; spectrum: SpectrumResponse | null }
const empty: DetailData = { waveform:null, features:null, indices:null, spectrum:null };
export function MeasurementDetail(props: MeasurementDetailProps) {
 // 측정 키 변경 시 이전 버퍼를 즉시 폐기한다.
 return <MeasurementDetailBody key={`${props.orgId ?? ''}:${props.sessionId}:${props.participantId}`} {...props}/>;
}
function MeasurementDetailBody({ sessionId, participantId, orgId, onClose, onSelectionChange }: MeasurementDetailProps) {
 const [tab,setTab] = useState<SignalType | 'features'>('eeg');
 const [range,setRange] = useState<MeasurementSelection>({ fromUs:'0',toUs:'10000000' });
 const [span,setSpan] = useState(10);
 const [start,setStart] = useState('0'); const [end,setEnd] = useState('10');
 const [data,setData] = useState<DetailData>(empty);
 const [loading,setLoading] = useState(false); const [error,setError] = useState('');
 const [rangeError,setRangeError] = useState(''); const generation = useRef(0); const active = useRef<AbortController | null>(null);
 useEffect(()=>{
  const controller = new AbortController(); active.current = controller;
  const request = ++generation.current;
  setData(empty); setLoading(true); setError('');
  const publish = <K extends keyof DetailData>(key: K, value: DetailData[K]) => { if (!controller.signal.aborted && generation.current === request) setData(previous=>({...previous,[key]:value})); };
  const fail = (cause: unknown) => { if (!controller.signal.aborted && generation.current === request) setError(cause instanceof Error ? cause.message : '측정 조회에 실패했습니다.'); };
  const options = [sessionId,participantId,range,orgId,controller.signal] as const;
  const requests = [
   tab === 'features' ? Promise.resolve() : measurementApi.waveform(sessionId,participantId,range,tab,orgId,controller.signal).then(value=>publish('waveform',value)).catch(fail),
   measurementApi.features(...options).then(value=>publish('features',value)).catch(fail),
   measurementApi.indices(...options).then(value=>publish('indices',value)).catch(fail),
   measurementApi.spectrum(...options).then(value=>publish('spectrum',value)).catch(fail),
  ];
  void Promise.all(requests).then(()=>{ if (!controller.signal.aborted && generation.current === request) setLoading(false); });
  return ()=>{ controller.abort(); generation.current++; };
 },[sessionId,participantId,orgId,range,tab]);
 function selectRange(from: number,to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to-from > 60 || to > Number.MAX_SAFE_INTEGER/1e6) { setRangeError('0초 이상, 종료 > 시작, 최대 60초 구간을 입력하세요.'); return; }
  setRangeError(''); const next={ fromUs:String(Math.round(from*1e6)),toUs:String(Math.round(to*1e6)) };
  setData(empty);setStart(String(from));setEnd(String(to));setRange(next);onSelectionChange?.(next);
 }
 async function more(kind: 'features' | 'indices') {
  const cursor=data[kind]?.next_cursor; const request=generation.current; const controller=active.current;
  if (!cursor || !controller || loading) return;
  setLoading(true);
  try {
   if(kind==='features') { const next=await measurementApi.features(sessionId,participantId,range,orgId,controller.signal,cursor); if(!controller.signal.aborted && request===generation.current) setData(prev=>({...prev,features:{...next,items:[...(prev.features?.items ?? []),...next.items]}})); }
   else { const next=await measurementApi.indices(sessionId,participantId,range,orgId,controller.signal,cursor); if(!controller.signal.aborted && request===generation.current) setData(prev=>({...prev,indices:{...next,items:[...(prev.indices?.items ?? []),...next.items]}})); }
  } catch(cause) { if(!controller.signal.aborted && request===generation.current) setError(cause instanceof Error?cause.message:'추가 조회에 실패했습니다.'); }
  finally { if(!controller.signal.aborted && request===generation.current) setLoading(false); }
 }
 return <section className="dc-measurement" aria-label="측정 상세"><header className="dc-measure-heading"><div><h2>측정 데이터</h2><p>측정 1건의 원파형·원 feature·당시 표시 이력</p></div>{onClose && <button type="button" onClick={onClose}>닫기</button>}</header>
 <div className="dc-measure-tabs" role="tablist" aria-label="측정 신호">{(['eeg','ppg','acc','features'] as const).map(value=><button key={value} type="button" role="tab" aria-selected={tab===value} onClick={()=>{if(tab!==value){setData(empty);setTab(value);}}}>{value==='features'?'feature 표':`${value.toUpperCase()} 원파형`}</button>)}</div>
 <div className="dc-measure-controls"><button type="button" disabled={Number(range.fromUs)===0} onClick={()=>{const from=Math.max(0,Number(range.fromUs)/1e6-span);selectRange(from,from+span);}}>← 이전</button><label>표시 구간<select aria-label="원파형표시 구간" value={span} onChange={event=>{const value=Number(event.target.value);setSpan(value);selectRange(Number(range.fromUs)/1e6,Number(range.fromUs)/1e6+value);}}>{[10,30,60].map(value=><option key={value} value={value}>{value}초</option>)}</select></label><button type="button" onClick={()=>selectRange(Number(range.fromUs)/1e6+span,Number(range.fromUs)/1e6+span*2)}>다음 →</button><label>선택 시작 초<input type="number" aria-label="선택 시작 초" min="0" value={start} onChange={e=>setStart(e.target.value)}/></label><label>선택 종료 초<input type="number" aria-label="선택 종료 초" min="0" value={end} onChange={e=>setEnd(e.target.value)}/></label><button type="button" onClick={()=>selectRange(Number(start),Number(end))}>구간 적용</button></div>
 <p className="dc-measure-note">선택 {Number(range.fromUs)/1e6}–{Number(range.toUs)/1e6}초 · [시작, 종료) · 파형·feature·표시값·PSD 공통 범위</p>
 {rangeError && <p role="alert">{rangeError}</p>}{error && <p role="alert">{error}</p>}{loading && <p role="status">측정 데이터불러오는 중…</p>}
 <div className="dc-measure-panel">{tab==='features' ? data.features && <FeatureTable data={data.features} onMore={()=>void more('features')} loading={loading}/> : data.waveform && <SignalWaveform data={data.waveform}/>}</div>
 {data.spectrum && <SpectrumPanel data={data.spectrum}/>}{data.indices && <IndicesChart data={data.indices} selection={range} onMore={()=>void more('indices')} loading={loading}/>}
 </section>;
}
export default MeasurementDetail;
