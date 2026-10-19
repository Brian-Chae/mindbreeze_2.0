// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSessionLiveSocket } from '../src/hooks/useSessionLiveSocket';
const io=vi.hoisted(()=>({listeners:new Map<string,Set<(data:unknown)=>void>>(),emit:vi.fn()}));
vi.mock('../src/lib/socket',async original=>({...await original<typeof import('../src/lib/socket')>(),getSessionLiveSocket:()=>({connected:true,emit:io.emit,
  on:(event:string,fn:(data:unknown)=>void)=>{const set=io.listeners.get(event)??new Set();set.add(fn);io.listeners.set(event,set);},
  off:(event:string,fn:(data:unknown)=>void)=>io.listeners.get(event)?.delete(fn),
})}));
let root:Root;let live:ReturnType<typeof useSessionLiveSocket>;
function Harness(){live=useSessionLiveSocket({sessionId:'s217',participantId:'p217',skipAuth:true});return null;}
async function receive(event:string,data:unknown){await act(async()=>{io.listeners.get(event)?.forEach(fn=>fn(data));});}
const joined={session_id:'s217',participant_id:'p217',snapshot:{session_id:'s217',status:'in_progress',version:1,participants:[]}};
beforeEach(()=>{vi.useFakeTimers();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});io.listeners.clear();io.emit.mockClear();root=createRoot(document.createElement('div'));});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();});
it('확정 joined 뒤 30초마다 본문 ID 없는 heartbeat를 보내고 unmount 때 정리한다',async()=>{
  await act(async()=>root.render(<Harness/>));await act(async()=>vi.advanceTimersByTimeAsync(30000));
  expect(io.emit.mock.calls.filter(c=>c[0]==='participation_heartbeat')).toHaveLength(0);
  await receive('joined',joined);await act(async()=>vi.advanceTimersByTimeAsync(60000));
  expect(io.emit.mock.calls.filter(c=>c[0]==='participation_heartbeat')).toEqual([['participation_heartbeat',{}],['participation_heartbeat',{}]]);
});
it('access_revoked 뒤 reconnect·늦은 joined·신호·heartbeat를 차단한다',async()=>{
  await act(async()=>root.render(<Harness/>));await receive('joined',joined);await receive('access_revoked',{session_id:'s217'});
  const joins=io.emit.mock.calls.filter(c=>c[0]==='join').length;
  await receive('connect',undefined);await receive('joined',joined);await act(async()=>vi.advanceTimersByTimeAsync(30000));
  expect(io.emit.mock.calls.filter(c=>c[0]==='join')).toHaveLength(joins);expect(live.isReady).toBe(false);expect(live.sendSignal('resting')).toBe('failed');
  expect(io.emit.mock.calls.filter(c=>c[0]==='participation_heartbeat')).toHaveLength(0);
});
