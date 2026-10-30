import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api/client';
import { getMockState } from '../../lib/class-report/mocks';
import { classSummaryApi } from '../../lib/api/class-summary';
import { PLAYER_METRICS } from '../../lib/class/player-case';
import { METRIC_KEYS, type ClassReportResponse, type NarrativeField, type NarrativeFieldKey, type NarrativePatchRequest } from '../../lib/class-report/types';
import { stateCopy } from '../../lib/class-report/state-copy';
import { formatEditedAt } from '../../lib/class-report/format';
import { WELLNESS_DISCLAIMER } from '../../lib/legal-copy';
import { NarrativeText } from './NarrativeText';
import { MetricStoryCard } from './MetricStoryCard';
import { FlowChart } from './FlowChart';
import { ParticipantTable } from './ParticipantTable';
import './class-report.css';
interface Props { data:ClassReportResponse; onRetry?:()=>void; onPatch?:(r:NarrativePatchRequest)=>Promise<NarrativeField> }
export function ClassNarrativeReport({data,onRetry,onPatch}:Props) {
  const { search } = useLocation();
  const block=data.block;
  const status=block?.status??'pending';
  const pending=status==='pending';
  const single=status==='single'||block?.scope.measured===1;
  const fields=block?.narrative.fields??{};
  const save=onPatch??(async(request:NarrativePatchRequest)=>(await classSummaryApi.patchNarrative(data.session.id,request)).value);
  const narrative=(key:NarrativeFieldKey,headline=false,evidenceHref?:string)=>fields[key]&&<NarrativeText key={key} field={key} value={fields[key]} canEdit={data.capabilities.can_edit_narrative} onSave={save} headline={headline} evidenceHref={evidenceHref}/>;
  const sections=[['cr-cover','01','오늘 수업 한 줄'],['cr-attendance','02','함께한 사람들'],['cr-journey','03','수업 흐름'],['cr-body','04','몸과 마음의 변화'],['cr-people','05','참여자별로 이어보기']];
  return <div className="cr-report"><header className="cr-header"><div><strong className="cr-brand">mind breeze <span>/ 코치용 클래스 리포트</span></strong><p className="cr-caption">{data.session.class_name} {data.session.seq!==null?`${data.session.seq}회차`:''} · {formatEditedAt(data.session.ended_at)} 종료 · {data.session.duration_min}분 진행</p></div><div className="cr-actions"><span className="cr-chip">코치 전용 · 발송 대상 아님</span><Link className="cr-button" to="/classes">목록으로</Link></div></header><div className="cr-review-tools"><span>{getMockState()?'합성 샘플 · 실제 발송·AI 호출 없음':'명상 클래스 서사형 리포트'}</span><div className="cr-actions"><span className="cr-chip">리포트 {pending?'생성 중':status==='error'?'조회 확인 필요':'생성 완료'}</span><Link className="cr-button" to={`/sessions/${data.session.id}/summary${search}`}>회차 요약으로</Link></div></div><div className="cr-layout"><aside aria-label="리포트 탐색"><p>코치 전용 리포트</p><nav>{sections.filter((_,index)=>status!=='zero'||index<2).map(([target,num,title])=><a key={target} href={`#${target}`}><span>{num}</span>{title}</a>)}</nav><p>한 수업의 흐름에서<br/>각자의 이야기로.<br/><br/>코치 검토용</p></aside><main><article>
    <section className="cr-cover" id="cr-cover" data-section="S1"><div className="cr-number">01 / 오늘 수업 한 줄</div><p className="cr-caption">{data.session.class_name} · {data.session.seq}회차</p>{fields.headline?narrative('headline',true,'#cr-body'):<h1>{stateCopy(status)}</h1>}{block?.flags.includes('partial')&&<p className="cr-caption">측정한 {block.scope.measured}명 기준으로 정리했어요. 전체 참석자를 대표하지는 않아요.</p>}{(status==='lost'||block?.flags.includes('lost'))&&<p>일부 구간은 연결이 끊겨 제외됐어요.</p>}{!single&&!pending&&block&&<div className="cr-summary-chips">{[['몸',METRIC_KEYS.slice(0,3)],['마음',METRIC_KEYS.slice(3)]].map(([label,keys])=>{const visible=(keys as typeof METRIC_KEYS[number][]).filter(key=>block.metrics[key].state==='ok'&&block.metrics[key].measured>=2&&block.metrics[key].direction!==null);return visible.length>0&&<span key={label as string}>{label as string} · {visible.map(key=>`${PLAYER_METRICS.find(m=>m.key===key)!.label} ${block.metrics[key].direction==='up'?'↑':block.metrics[key].direction==='down'?'↓':'→'}`).join(' · ')}</span>;})}</div>}{block&&block.scope.measured>=2&&<p className="cr-caption">측정 {block.scope.measured}명 기준 · 개인의 경험을 대신하지 않아요.</p>}{status==='error'&&<button type="button" onClick={onRetry}>다시 불러오기</button>}</section>
    <section id="cr-attendance" data-section="S2"><SectionHeading number="02" label="함께한 사람들" title="함께한 시간을 기록해요."/><dl className="cr-meta">{[['참석',block?.scope.attended],['측정',block?.scope.measured],['리포트 대상',block?.scope.included]].map(([label,count])=><div key={label}><dt>{label}</dt><dd>{pending?'확인 중':status==='error'?'—':`${count??0}명`}</dd></div>)}</dl><p className="cr-caption">{pending?'측정 인원과 리포트 대상을 확인하고 있어요.':status==='error'?'인원을 불러오지 못했어요.':status==='zero'?'이번 회차에는 참석 기록이 없어요.':block?`참석한 ${block.scope.attended}명 중 ${block.scope.measured}명이 LINK BAND로 측정했어요. 지표별 측정 인원은 각 지표에서 확인해요.`:''}</p></section>
    {status!=='zero'&&<><section id="cr-journey" data-section="S3"><SectionHeading number="03" label="수업 흐름" title="수업이 흘러간 모습"/>{!single&&!pending&&status!=='error'&&narrative('flow')}<FlowChart block={block}/></section><section id="cr-body" data-section="S4"><SectionHeading number="04" label="몸과 마음의 변화" title={<>몸의 리듬에서,<br/>마음의 흐름으로.</>}/><p className="cr-caption">전반 0–{block?.scope.split_min??data.session.duration_min/2}분 ↔ 후반 {block?.scope.split_min??data.session.duration_min/2}–{data.session.duration_min}분 · 비교 가능한 참여자의 값을 동등하게 반영해요.</p>{status==='unworn'?<div className="cr-note"><h3>측정 없음</h3><p>이번 수업은 LINK BAND 없이 진행됐어요. 참여 기록과 코멘트로 리포트를 이어갈 수 있어요.</p></div>:status==='error'?<div className="cr-note">몸과 마음의 변화를 불러오지 못했어요.</div>:([['몸의 리듬','body_subtitle',METRIC_KEYS.slice(0,3)],['마음의 흐름','mind_subtitle',METRIC_KEYS.slice(3)]] as const).map(([title,key,keys])=><div className="cr-change-group" key={key}><h3>{title}</h3>{!single&&!pending&&narrative(key,false,`#cr-metric-${keys[0]}`)}{keys.map(keyName=><MetricStoryCard key={keyName} keyName={keyName} metric={block?.metrics[keyName]} narrative={fields[`metric.${keyName}`]} canEdit={data.capabilities.can_edit_narrative} onSave={save} duration={data.session.duration_min} split={block?.scope.split_min??data.session.duration_min/2} pending={pending} single={single}/>)}</div>)}</section><section id="cr-people" data-section="S5"><SectionHeading number="05" label="참여자별로 이어보기" title="이제, 각자의 이야기로"/><ParticipantTable data={data} onSave={save}/></section></>}
    <footer>이 요약은 코치에게만 보여요. 참여자에게는 승인된 개인 리포트만 전달돼요.<br/>{WELLNESS_DISCLAIMER}</footer></article></main></div></div>;
}
function SectionHeading({number,label,title}:{number:string;label:string;title:React.ReactNode}){return <><div className="cr-number">{number} / {label}</div><h2>{title}</h2></>;}
export function ClassReportLoader({sessionId}:{sessionId:string}) {
  const {search}=useLocation();
  const navigate=useNavigate();
  const [loaded,setLoaded]=useState<{id:string;data:ClassReportResponse}|null>(null);
  const data=loaded?.id===sessionId?loaded.data:null;
  const [failedId,setFailedId]=useState<string|null>(null);
  const failed=failedId===sessionId;
  const generation=useRef(0);
  const load=useCallback(async()=>{const current=++generation.current;try{const response=await classSummaryApi.report(sessionId);if(current!==generation.current)return;setLoaded({id:sessionId,data:response});setFailedId(null);}catch(error){if(current!==generation.current)return;if(error instanceof ApiError&&error.status===400){navigate(`/sessions/${sessionId}/record`,{replace:true});return;}setFailedId(sessionId);}},[sessionId,navigate]);
  const invalidate=useCallback(()=>{generation.current++;},[]);
  useEffect(()=>{void load();return invalidate;},[load,invalidate]);
  const processing=!data||!data.block||data.block.status==='pending'||data.report.generation_status==='pending'||data.report.generation_status==='processing'||data.report.narrative_pending;
  useEffect(()=>{const focus=()=>void load();window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[load]);
  useEffect(()=>{if(!processing)return;const timer=window.setInterval(()=>void load(),10000);return()=>window.clearInterval(timer);},[load,processing]);
  if(!data)return <div className="cr-report cr-loading"><h1>{failed?'요약을 불러오지 못했어요.':'수업 분석을 확인하고 있어요.'}</h1>{failed&&<button type="button" onClick={()=>void load()}>다시 불러오기</button>}<Link className="cr-button" to={`/sessions/${sessionId}/summary${search}`}>회차 요약으로</Link><p>이 요약은 코치에게만 보여요.</p><p>{WELLNESS_DISCLAIMER}</p></div>;
  return <>{failed&&<div className="cr-refresh-error" role="alert">최신 내용을 불러오지 못했어요. 이전 조회 결과를 표시해요. <button type="button" onClick={()=>void load()}>다시 불러오기</button></div>}<ClassNarrativeReport key={sessionId} data={data} onRetry={()=>void load()} onPatch={async request=>{const response=await classSummaryApi.patchNarrative(sessionId,request);generation.current++;setLoaded(current=>current?.id===sessionId&&current.data.block?{...current,data:{...current.data,block:{...current.data.block,narrative:{...current.data.block.narrative,fields:{...current.data.block.narrative.fields,[response.field]:response.value}}}}}:current);return response.value;}}/></>;
}
