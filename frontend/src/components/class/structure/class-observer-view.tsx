import { useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer, VideoTrack, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { classOperationsApi, type Observation } from '../../../lib/api/class-operations';
import { resolveLiveKitUrl } from '../../../lib/livekit-url';
import { operationButton, operationError } from './class-operation-state';
function ObserverVideo() {
 const tracks=useTracks([Track.Source.Camera,Track.Source.ScreenShare]);
 return <><div className="grid gap-3 md:grid-cols-2">{tracks.filter(t=>!t.participant.isLocal).map(t=><VideoTrack key={`${t.participant.identity}:${t.source}`} trackRef={t} className="w-full rounded-xl"/> )}</div><RoomAudioRenderer/></>;
}
export function ClassObserverView({classId,sessionId}:{classId:string;sessionId:string}) {
 const [observation,setObservation]=useState<Observation|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const enter=async()=>{setBusy(true);setError('');try{setObservation(await classOperationsApi.observe(classId,sessionId));}catch(e){setError(operationError(e));}finally{setBusy(false);}};
 return <section className="space-y-4 rounded-2xl border border-[#e5dfd6] bg-white p-6"><h2 className="text-lg font-semibold">참관</h2><p className="text-sm text-gray-500">수업의 음성·영상을 받기만 해요. 송출·녹음·발언권 제어와 실시간 개인 뇌파 지표는 제공하지 않아요. 입장 회원의 새 고지 확인 후 서버에서 참관을 허용해요.</p>{error&&<p role="alert">{error}</p>}{observation?<><LiveKitRoom token={observation.token} serverUrl={resolveLiveKitUrl()} connect audio={false} video={false} screen={false} onDisconnected={()=>{setObservation(null);setError('참관 연결이 종료됐어요. 현재 권한을 다시 확인한 뒤 입장해 주세요.');}} onError={e=>{setObservation(null);setError(e.message);}}><ObserverVideo/></LiveKitRoom><button className={operationButton} onClick={()=>setObservation(null)}>참관 나가기</button></>:<button className={operationButton} disabled={busy} onClick={()=>void enter()}>참관 권한 확인하고 입장</button>}</section>;
}
