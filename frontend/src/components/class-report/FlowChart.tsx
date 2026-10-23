import { useId, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { PLAYER_METRICS } from '../../lib/class/player-case';
import type { ClassMetric, ClassReportBlock, MetricKey } from '../../lib/class-report/types';
import { formatValue } from '../../lib/class-report/format';

interface MetricLineProps { metrics: Partial<Record<MetricKey, ClassMetric>>; keys: MetricKey[]; duration: number; split: number; small?: boolean }
export function MetricLine({ metrics, keys, duration, split, small = false }: MetricLineProps) {
  const times = [...new Set(keys.flatMap(key => metrics[key]?.series.map(point => point.t_min) ?? []))].sort((a,b)=>a-b);
  const data = times.map(time => Object.fromEntries([['minute', time], ...keys.map(key => { const metric=metrics[key]; const point=metric?.series.find(p=>p.t_min===time); return [key, metric?.state==='ok' && metric.measured>=2 && point && point.n>=2 ? point.v : null]; })]));
  const definition = PLAYER_METRICS.find(metric=>metric.key===keys[0])!;
  const mind = definition.group === 'MIND';
  const domain: [number,number] = mind ? [0,100] : [Math.min(0,definition.scale.member[0]), Math.max(definition.scale.member[1], ...keys.flatMap(key=>metrics[key]?.series.flatMap(point=>point.v===null?[]:[point.v])??[]))];
  return <div className={`cr-line${small?' cr-spark':''}`} role="img" aria-label={`${keys.map(key=>PLAYER_METRICS.find(m=>m.key===key)!.label).join('・')} ${definition.unit} · ${small?'시간 추이':'클래스 평균'} · 결측 구간은 연결하지 않아요`}>
    {!small && <div className="cr-halves"><span>전반</span><span>후반</span></div>}
    <ResponsiveContainer width="100%" height={small?80:240} minWidth={0}>
      <LineChart data={data} margin={{top:10,right:12,bottom:4,left:0}} accessibilityLayer>
        <CartesianGrid stroke="#e9e4ec" vertical={false}/>
        <XAxis type="number" dataKey="minute" domain={[0,duration]} ticks={small?[0,duration]:undefined} tick={{fontSize:13,fill:'#665e6c'}} tickFormatter={v=>`${v}`} minTickGap={24} tickLine={false} axisLine={false}/>
        <YAxis type="number" domain={domain} ticks={mind?[0,50,100]:undefined} width={small?30:40} tick={{fontSize:13,fill:'#665e6c'}} tickLine={false} axisLine={false}/>
        <ReferenceLine x={split} stroke="#b5a8bf" strokeDasharray="5 5"/>
        {keys.map(key=><Line key={key} dataKey={key} type="linear" stroke={`var(${PLAYER_METRICS.find(m=>m.key===key)!.colorVar})`} strokeWidth={small?2:3} dot={small?false:{r:3,strokeWidth:1}} connectNulls={false} isAnimationActive={false}/>)}
      </LineChart>
    </ResponsiveContainer>
    <p className="cr-caption cr-axis-unit">경과 시간 · 분 / {definition.unit}</p>
  </div>;
}
export function FlowChart({ block }: { block: ClassReportBlock | null }) {
  const [tab,setTab] = useState<'mind'|'body'>('mind');
  const [selected,setSelected] = useState(0);
  const selectId = useId();
  if (!block || block.status==='pending') return <div className="cr-skeleton" role="status">수업 분석 중 · 완료되면 흐름이 표시돼요.</div>;
  if(block.status==='single' || block.scope.measured===1) return <div className="cr-note">측정 1명 — 참여자별 결과에서 확인</div>;
  if(block.status==='unworn') return <details><summary>측정 데이터가 없어 흐름 그래프는 생략돼요</summary><p>이번 회차는 측정 없이 진행됐어요.</p></details>;
  if(block.status==='error') return <div className="cr-note">흐름 그래프를 불러오지 못했어요.</div>;
  if(!Object.values(block.metrics).some(metric=>metric.state==='ok'&&metric.measured>=2&&metric.series.some(point=>point.n>=2&&point.v!==null))) return <div className="cr-note">연결된 유효 구간이 없어 흐름 그래프는 보여드리지 못해요.</div>;
  const keys:MetricKey[]=tab==='mind'?['focus','relaxation','emotional']:['respiration','bpm','hrv'];
  const definitions=keys.map(key=>PLAYER_METRICS.find(metric=>metric.key===key)!);
  const times=[...new Set(keys.flatMap(key=>block.metrics[key].series.map(p=>p.t_min)))].sort((a,b)=>a-b);
  const time=times[Math.min(selected,times.length-1)];
  const split=block.scope.split_min??block.scope.duration_min/2;
  return <><div className="cr-chart-tabs" role="group" aria-label="수업 흐름 지표"><button type="button" aria-pressed={tab==='mind'} onClick={()=>{setTab('mind');setSelected(0);}}>마음</button><button type="button" aria-pressed={tab==='body'} onClick={()=>{setTab('body');setSelected(0);}}>몸</button></div><div className="cr-legend">{definitions.map(metric=><span key={metric.key}><i style={{background:`var(${metric.colorVar})`}}/>{metric.label} ({metric.unit})</span>)}</div>
    {tab==='mind'?<MetricLine metrics={block.metrics} keys={keys} duration={block.scope.duration_min} split={split}/>:keys.map(key=><figure key={key}><figcaption>{PLAYER_METRICS.find(m=>m.key===key)!.label} · {block.metrics[key].unit}</figcaption>{block.metrics[key].state==='ok'&&block.metrics[key].measured>=2?<MetricLine metrics={block.metrics} keys={[key]} duration={block.scope.duration_min} split={split}/>:<div className="cr-note">신호가 고르지 않아 계산하지 못했어요.</div>}</figure>)}
    <div className="cr-phases"><span>처음</span><span>중간</span><span>마무리</span></div><p className="cr-caption">측정 {block.scope.measured}명 기준 · {block.scope.bucket_min}분 구간 평균 · 전반/후반 경계 {formatValue(split)}분</p>
    {times.length>0&&<><label className="cr-field" htmlFor={selectId}>구간의 값 확인</label><select id={selectId} value={Math.min(selected,times.length-1)} onChange={event=>setSelected(Number(event.target.value))}>{times.map((minute,index)=><option key={minute} value={index}>{minute}–{Math.min(minute+block.scope.bucket_min,block.scope.duration_min)}분</option>)}</select><p className="cr-note" aria-live="polite">{keys.map(key=>{const point=block.metrics[key].series.find(p=>p.t_min===time);const valid=block.metrics[key].state==='ok'&&block.metrics[key].measured>=2&&point&&point.n>=2&&point.v!==null;return `${PLAYER_METRICS.find(m=>m.key===key)!.label} ${valid?`${formatValue(point.v)}${block.metrics[key].unit}`:'— · 자료 없음'}`;}).join(' · ')}</p></>}
    <p className="cr-caption">몸 지표는 서로 다른 축을 사용해요. 그래프 높이를 지표 사이에서 비교하지 마세요. 측정이 2명 미만인 구간은 연결하지 않아요.</p>
  </>;
}
