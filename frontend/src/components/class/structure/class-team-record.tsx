import {useEffect,useRef,useState} from 'react';
import {getRecord,type RecordResponse} from '../../../lib/api/audio';
import {AISummaryTab} from '../../records/AISummaryTab';
import {operationButton,operationError} from './class-operation-state';
export function ClassTeamRecord({sessionId}:{sessionId:string}) {
 const [record,setRecord]=useState<RecordResponse|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const generation=useRef(0);
 useEffect(()=>{generation.current+=1;setRecord(null);setError('');return()=>{generation.current+=1;};},[sessionId]);
 const load=async()=>{const version=generation.current;setBusy(true);setError('');try{const data=await getRecord(sessionId);if(version===generation.current)setRecord(data);}catch(e){if(version===generation.current)setError(operationError(e));}finally{if(version===generation.current)setBusy(false);}};
 return <section className="space-y-4 rounded-2xl border border-[#e5dfd6] bg-white p-6"><h2 className="text-lg font-semibold">강사팀 기록 열람</h2><p className="text-sm text-gray-500">현재 팀 권한과 회원의 개정 고지 확인을 서버에서 검사해요. 전사 원문·음성·영상·편집 이력은 제공하지 않아요.</p><button className={operationButton} disabled={busy} onClick={()=>void load()}>{record?'기록 새로고침':'기록 읽기'}</button>{error&&<p role="alert">{error}</p>}{record&&<><AISummaryTab aiSummary={record.ai_summary}/><div><h3 className="font-semibold">진행 지도사 메모</h3><p className="mt-2 whitespace-pre-wrap text-sm">{record.counselor_notes??'작성된 메모가 없어요.'}</p></div></>}</section>;
}
