import { useId } from 'react';
import { PLAYER_METRICS } from '../../lib/class/player-case';
import type { ClassMetric, MetricKey, NarrativeField, NarrativeFieldKey, NarrativePatchRequest } from '../../lib/class-report/types';
import { directionLabel, formatDelta, formatValue } from '../../lib/class-report/format';
import { NarrativeText } from './NarrativeText';
import { MetricLine } from './FlowChart';
const descriptions:Record<MetricKey,[string,string]>={
  respiration:['1분 동안 숨을 쉬는 횟수예요.','호흡수가 낮아지면 숨 쉬는 횟수가 줄었다는 뜻이에요.'],
  bpm:['1분 동안 심장이 뛰는 횟수예요.','값이 낮아지면 1분 동안의 심장 박동 횟수가 줄었다는 뜻이에요.'],
  hrv:['심장 박동 간격의 변화를 나타내요.','값이 높아지면 박동 사이 간격의 변화가 커졌다는 뜻이에요.'],
  focus:['주의를 기울이는 흐름을 나타내는 신호예요.','값이 높아지면 집중 신호가 더 높게 나타났다는 뜻이에요.'],
  relaxation:['이완과 관련된 신호의 흐름이에요.','값이 높아지면 이완 신호가 더 높게 나타났다는 뜻이에요.'],
  emotional:['정서 안정과 관련된 신호의 흐름이에요.','값이 높아지면 정서 안정 신호가 더 높게 나타났다는 뜻이에요.'],
};
/** 기존 개인 리포트의 두 막대 표현을 클래스 단위·식별색·13px에 맞춘다. */
function DualBarChart({metric,keyName}:{metric:ClassMetric;keyName:MetricKey}) {
  const id=useId();const def=PLAYER_METRICS.find(m=>m.key===keyName)!;
  const max=Math.max(def.scale.member[1],metric.early??0,metric.late??0);
  return <figure className="cr-dual-bar"><figcaption>전반 / 후반 · {def.unit}</figcaption><svg viewBox="0 0 320 110" role="img" aria-labelledby={id}><title id={id}>{def.label} 전반과 후반 평균</title>{[metric.early,metric.late].map((value,index)=><g key={index}><text x="0" y={index*48+20} fontSize="13" fill="#665e6c">{index===0?'전반':'후반'} {formatValue(value)} {def.unit}</text><rect x="0" y={index*48+28} width={Math.max(0,(value??0)/max*300)} height="10" rx="5" fill={index===0?'#d9d1de':`var(${def.colorVar})`}/></g>)}</svg></figure>;
}
export function MetricStoryCard({keyName,metric,narrative,canEdit,onSave,duration,split,pending=false,single=false}:{keyName:MetricKey;metric:ClassMetric|undefined;narrative?:NarrativeField;canEdit:boolean;onSave:(r:NarrativePatchRequest)=>Promise<NarrativeField>;duration:number;split:number;pending?:boolean;single?:boolean}) {
  const def=PLAYER_METRICS.find(m=>m.key===keyName)!;
  const isSingle=single||metric?.state==='single'||metric?.state==='ok'&&metric.measured===1;
  const valid=!pending&&!isSingle&&metric?.state==='ok'&&metric.measured>=2&&metric.mean!==null;
  const comparison=valid&&metric.compared>=2&&metric.early!==null&&metric.late!==null&&metric.delta!==null;
  const detail=pending?'분석이 끝나면 표시돼요.':isSingle?'참여자별 결과에서 확인':metric?.state==='lost'?'연결된 유효 구간이 없어 계산하지 못했어요.':metric?.state==='unworn'?'측정 없이 참여했어요.':'신호가 고르지 않아 계산하지 못했어요. 명상 성과에 대한 평가가 아닙니다.';
  return <details className="cr-metric" id={`cr-metric-${keyName}`} data-metric={keyName}><summary><span className="cr-metric-name"><i style={{background:`var(${def.colorVar})`}}/>{def.label}<small>{def.group==='BODY'?'PPG':'EEG'}{keyName==='hrv'?' · 심박 간격의 변화':''}</small></span><span className="cr-metric-value">{valid?`${formatValue(metric.mean)} ${def.unit}`:isSingle?'측정 1명':'—'}</span><span className="cr-metric-delta">{comparison?`${formatValue(metric.early)} → ${formatValue(metric.late)}  ${formatDelta(metric.delta)} ${def.unit==='%'?'%p':def.unit} · ${directionLabel(metric.direction)}`:detail}</span><span className="cr-caption">자세히</span></summary><div className="cr-metric-inside">{valid&&narrative?<NarrativeText field={`metric.${keyName}` as NarrativeFieldKey} value={narrative} canEdit={canEdit} onSave={onSave}/>:<p>{detail}</p>}{valid&&<><div className="cr-statline"><span>측정 {metric.measured}명 · 개인 평균 범위 {formatValue(metric.min)}–{formatValue(metric.max)} {def.unit}</span><span>비교 {metric.compared}명 · 유효 {formatValue(metric.valid_min)}분 ({formatValue(metric.valid_ratio===null?null:metric.valid_ratio*100)}%)</span></div>{comparison&&<div className="cr-dualcharts"><DualBarChart metric={metric} keyName={keyName}/><figure><figcaption>시간 추이 · {def.unit}</figcaption><MetricLine metrics={{[keyName]:metric}} keys={[keyName]} duration={duration} split={split} small/></figure></div>}{metric.compared>=3&&metric.agreement&&<p className="cr-caption">비교 {metric.compared}명 중 {metric.agreement.up}명 증가 · {metric.agreement.stable}명 유지 · {metric.agreement.down}명 감소</p>}</>}<div className="cr-read"><p>{descriptions[keyName][0]}</p><p className="cr-caption">읽는 법 · {descriptions[keyName][1]}</p></div></div></details>;
}
