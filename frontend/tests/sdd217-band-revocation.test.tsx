// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const io=vi.hoisted(()=>({listeners:new Map<string,Set<(data:unknown)=>void>>(),join:vi.fn(),release:vi.fn()}));
vi.mock('../src/lib/socket',async original=>({...await original<typeof import('../src/lib/socket')>(),
  getSessionLiveSocket:()=>({connected:true,on:(name:string,fn:(data:unknown)=>void)=>{const set=io.listeners.get(name)??new Set();set.add(fn);io.listeners.set(name,set);},off:(name:string,fn:(data:unknown)=>void)=>io.listeners.get(name)?.delete(fn)}),
  joinSessionLive:(...args:unknown[])=>io.join(...args),retainSessionLiveRoom:()=>undefined,releaseSessionLiveRoom:()=>io.release(),
  subscribeSessionLiveFeatureAck:()=>()=>undefined,subscribeSessionLiveEegFeature:()=>()=>undefined,
}));
vi.mock('../src/hooks/useEegRawUpload',()=>({useEegRawUpload:()=>({enqueueChunk:vi.fn(),drain:vi.fn()})}));
vi.mock('../src/lib/session-live/feature-queue',()=>({enqueueFeature:vi.fn(),listPendingFeatures:async()=>[],loadStreamCursor:async()=>({streamId:'test-stream',nextSequence:0}),removeAckedFeature:vi.fn()}));
vi.mock('../src/lib/eeg/eegPersonalScore',async original=>({...await original<typeof import('../src/lib/eeg/eegPersonalScore')>(),refreshActiveModel:async()=>undefined}));
import {useBand} from '../src/hooks/useBand';
let root:Root;
function Harness({revoked=false}:{revoked?:boolean}){useBand({sessionId:revoked?'':'s217',participantId:revoked?null:'p217',enabled:!revoked,skipAuth:true});return null;}
const receive=(event:string,data:unknown)=>act(async()=>{io.listeners.get(event)?.forEach(fn=>fn(data));});
beforeEach(()=>{vi.useFakeTimers();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});io.listeners.clear();io.join.mockClear();io.release.mockClear();root=createRoot(document.createElement('div'));});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();});
it('실제 BLE 훅도 권한회수 직후 같은 tick의 reconnect와 비활성화 뒤 reconnect를 막는다',async()=>{
  await act(async()=>root.render(<Harness/>));expect(io.join).toHaveBeenCalledTimes(1);
  await receive('access_revoked',{session_id:'s217'});await receive('connect',undefined);
  expect(io.join).toHaveBeenCalledTimes(1);
  await act(async()=>root.render(<Harness revoked/>));await receive('connect',undefined);
  expect(io.join).toHaveBeenCalledTimes(1);expect(io.release).toHaveBeenCalled();
});
