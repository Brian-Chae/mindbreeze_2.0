import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLAYER_METRICS } from '../../lib/class/player-case';
import { METRIC_KEYS, type ClassReportResponse, type NarrativeField, type NarrativeFieldKey, type NarrativePatchRequest, type ParticipantMeasurement } from '../../lib/class-report/types';
import { formatDelta, formatValue } from '../../lib/class-report/format';
import { NarrativeText } from './NarrativeText';
const measurementLabel:Record<ParticipantMeasurement,string>={measured:'측정 참여',unworn:'미착용',poor_signal:'몸 신호 확인 불가',lost:'연결 끊김',excluded:'리포트 미반영'};
const generationLabel={pending:'분석 중',processing:'분석 중',ready:'생성 완료',failed:'생성 확인 필요',none:'데이터 없음'};
const approvalLabel={pending_analysis:'분석 대기',pending_review:'검토 대기',completed:'승인됨',error:'승인 확인 필요',none:'승인 제외'};
const deliveryLabel={not_requested:'미전달',waiting:'전달 대기',sent:'전달 완료',failed:'전달 확인 필요',no_address:'전달 주소 없음',unknown:'전달 상태 확인 중'};
export function ParticipantTable({data,onSave}:{data:ClassReportResponse;onSave:(r:NarrativePatchRequest)=>Promise<NarrativeField>}) {
  const [query,setQuery]=useState('');const [filter,setFilter]=useState('all');const id=useId();
  const pending=!data.block||data.block.status==='pending';
  const rows=data.participants.filter(p=>p.display_name.includes(query.trim())&&(filter==='all'||filter==='ready'&&p.report.generation==='ready'||filter==='pending'&&['pending','processing'].includes(p.report.generation)||filter==='excluded'&&!p.included||filter==='review'&&p.report.approval==='pending_review'));
  return <><p>함께한 사람들을 한 명씩 볼 수 있어요.</p><div className="cr-search"><label htmlFor={`${id}-search`}>참여자 찾기<input id={`${id}-search`} value={query} onChange={e=>setQuery(e.target.value)} placeholder="참여자 이름 검색"/></label><label htmlFor={`${id}-filter`}>리포트 상태<select id={`${id}-filter`} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체</option><option value="ready">생성 완료</option><option value="pending">분석 중</option><option value="excluded">리포트 미반영</option><option value="review">검토 대기</option></select></label></div><table className="cr-participants"><thead><tr><th scope="col">참여자 · 이야기</th><th scope="col">측정</th><th scope="col">생성 / 승인 / 전달</th><th scope="col">결과</th></tr></thead><tbody>{rows.map(person=>{
    const narrative=person.narrative_field?data.block?.narrative.fields[person.narrative_field]:null;
    const isPending=pending||['pending','processing'].includes(person.report.generation);
    return <tr key={person.participant_id}><td data-label="참여자"><strong>{person.display_name}</strong>{isPending?<p>분석 중</p>:narrative?<NarrativeText field={person.narrative_field as NarrativeFieldKey} value={narrative} canEdit={data.capabilities.can_edit_narrative} onSave={onSave}/>:<p>{!person.included?'리포트 미반영':person.measurement==='unworn'?'측정 없이 참여 — 기록과 코멘트로 리포트가 이어져요.':measurementLabel[person.measurement]}</p>}</td><td data-label="측정">{isPending?'확인 중':measurementLabel[person.measurement]}</td><td data-label="리포트 상태">{generationLabel[person.report.generation]} / {approvalLabel[person.report.approval]} / {deliveryLabel[person.report.delivery]}</td><td>{person.included&&!isPending&&person.report.generation==='ready'&&person.report.id?<Link className="cr-button" to={`/reports/${person.report.id}`}>열기</Link>:<button type="button" disabled>열기</button>}</td></tr>;
  })}</tbody></table>{rows.length===0&&<p className="cr-note">검색 결과가 없습니다.</p>}
  <details className="cr-person-details"><summary>참여자별 6지표 상세 보기</summary>{rows.map(person=>{
    const result=data.block?.participants.find(p=>p.participant_id===person.participant_id);
    return <div key={person.participant_id}><h3>{person.display_name}</h3><div className="cr-person-metrics">{METRIC_KEYS.map(key=>{const metric=result?.metrics[key];const def=PLAYER_METRICS.find(m=>m.key===key)!;return <p key={key}><strong>{def.label}</strong><span>{formatValue(metric?.mean)} {def.unit} · Δ {formatDelta(metric?.delta)} {def.unit==='%'?'%p':def.unit}</span>{metric&&<span>유효 {formatValue(metric.valid_min)}분 ({formatValue(metric.valid_ratio===null?null:metric.valid_ratio*100)}%)</span>}</p>;})}</div><p className="cr-caption">{measurementLabel[person.measurement]}</p></div>;
  })}</details></>;
}
