// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ handlers: new Map<string, Set<(value: unknown) => void>>(), emit: vi.fn(), fetch: vi.fn() }));
vi.mock('../src/lib/socket', () => ({ getSessionLiveSocket: () => ({
  connected: true, emit: io.emit,
  on: (name: string, fn: (value: unknown) => void) => { const set=io.handlers.get(name) ?? new Set();set.add(fn);io.handlers.set(name,set); },
  off: (name: string, fn: (value: unknown) => void) => io.handlers.get(name)?.delete(fn),
}) }));
vi.mock('../src/lib/api/participation', () => ({ getParticipation: (...args: unknown[]) => io.fetch(...args) }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (select: (s: {accessToken:string}) => unknown) => select({accessToken:'test'}) }));
import { useParticipationSnapshot } from '../src/hooks/useParticipationSnapshot';
import { toHostParticipant } from '../src/components/class/player/host/host-live-model';
import { HostParticipantGrid } from '../src/components/class/player/host/HostParticipantGrid';
import { PLAYER_METRICS } from '../src/lib/class/player-case';
import type { SessionLiveMetric } from '../src/lib/api/session';
const participant = (presence='connected') => ({participant_id:'p',member_id:'m',canonical_member_id:'m',attendance_status:'attended',entered_at:'2026-01-01T00:00:00Z',checkin_state:'completed',checkin_at:'2026-01-01T00:00:00Z',presence_state:presence,presence_expires_at:new Date(Date.now()+90000).toISOString()});
const snapshot = (version: number, presence='connected') => ({session_id:'s',participation_version:version,generated_at:new Date().toISOString(),presence_ttl_seconds:90,participants:[participant(presence)]});
let root:Root;let box:HTMLDivElement;
function Harness({band=false,mixed=false}: {band?:boolean;mixed?:boolean}) {
  const state=useParticipationSnapshot({classId:'c',sessionId:'s'});
  const row={participant_id:'p',display_name:'회원',band_connected:band,device_status:'ok',last_eeg_at:band ? new Date().toISOString():null,...state.participants.p} as SessionLiveMetric;
  const person=toHostParticipant(row,{nowMs:Date.now()});
  return state.revoked ? <p>참여 권한이 종료되었습니다</p> : <><output>{state.version}</output><HostParticipantGrid participants={[person]} metric={PLAYER_METRICS[0]} allOff={!band && !mixed} netBad={false} selectedId={null} onSelect={()=>undefined} onRange={()=>undefined} table={false}/></>;
}
async function fire(name:string,event:unknown) { await act(async()=>{io.handlers.get(name)?.forEach(fn=>fn(event));}); }
beforeEach(()=>{vi.useFakeTimers();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});io.handlers.clear();io.fetch.mockReset();io.emit.mockReset();box=document.createElement('div');document.body.append(box);root=createRoot(box);});
afterEach(async()=>{await act(async()=>root.unmount());box.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('NV04/06: 저장된 before 완료를 새로고침 후 밴드 없이 복원한다',async()=>{
  io.fetch.mockResolvedValue(snapshot(4));await act(async()=>root.render(<Harness/>));
  expect(box.textContent).toContain('체크인 완료');expect(box.textContent).toContain('참여 중');expect(box.textContent).not.toContain('체크인 전');
});
it('NV08: 초기 조회 중 delta를 버퍼링하고 동일·역순 버전을 무시한다',async()=>{
  let resolve!:(value:unknown)=>void;io.fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  await act(async()=>root.render(<Harness/>));expect(box.textContent).toContain('접속 확인 중');expect(box.textContent).not.toContain('미입장');await fire('participant_changed',snapshot(5,'disconnected'));
  await act(async()=>resolve(snapshot(4)));expect(box.textContent).toContain('현재 미접속');
  await fire('participant_changed',snapshot(4));expect(box.textContent).toContain('현재 미접속');expect(box.querySelector('output')?.textContent).toBe('5');
});
it('NV08: 버전 gap과 재접속은 재조회하며 만료 뒤 실패하면 unknown을 표시한다',async()=>{
  io.fetch.mockResolvedValueOnce(snapshot(1));await act(async()=>root.render(<Harness/>));
  io.fetch.mockResolvedValueOnce(snapshot(4,'disconnected'));await fire('participant_changed',snapshot(4));expect(io.fetch).toHaveBeenCalledTimes(2);expect(box.textContent).toContain('현재 미접속');
  io.fetch.mockResolvedValueOnce(snapshot(5));await fire('connect',undefined);expect(io.fetch).toHaveBeenCalledTimes(3);
  io.fetch.mockRejectedValue(new Error('network'));await act(async()=>vi.advanceTimersByTimeAsync(91000));expect(box.textContent).toContain('접속 확인 중');expect(box.textContent).toContain('체크인 완료');
});
it('NV07: 초대·미입장·근거 없는 체크인을 현재 참여로 추정하지 않는다',async()=>{
  const value=snapshot(0,'unknown');value.participants[0]={...value.participants[0],entered_at:null,checkin_state:'unknown'} as unknown as ReturnType<typeof participant>;
  io.fetch.mockResolvedValue(value);await act(async()=>root.render(<Harness/>));expect(box.textContent).toContain('미입장');expect(box.textContent).toContain('체크인 확인 중');expect(box.textContent).not.toContain('참여 중');
});
it('접근 회수 후 늦은 조회·재접속으로 상태를 복원하지 않는다',async()=>{
  let resolve!:(value:unknown)=>void;io.fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await act(async()=>root.render(<Harness/>));
  await fire('access_revoked',{session_id:'s'});await act(async()=>resolve(snapshot(10)));await fire('connect',undefined);
  expect(box.textContent).toContain('참여 권한이 종료되었습니다');expect(io.fetch).toHaveBeenCalledTimes(1);
});

it('만료 조회 실패 이후 네트워크 복구 때 다시 조회하여 현재 접속을 회복한다',async()=>{
  io.fetch.mockResolvedValueOnce(snapshot(1));await act(async()=>root.render(<Harness/>));
  io.fetch.mockRejectedValueOnce(new Error('network'));await act(async()=>vi.advanceTimersByTimeAsync(91000));
  expect(box.textContent).toContain('접속 확인 중');io.fetch.mockResolvedValue(snapshot(2,'disconnected'));
  await act(async()=>vi.advanceTimersByTimeAsync(31000));expect(box.textContent).toContain('현재 미접속');
});
it('밴드 측정값이 남아 있어도 서버의 현재 접속 종료를 우선 표시한다',async()=>{
  io.fetch.mockResolvedValue(snapshot(1,'disconnected'));await act(async()=>root.render(<Harness band/>));
  expect(box.textContent).toContain('현재 미접속');expect(box.textContent).not.toContain('연결됨');
});

it('mixed-band 그리드의 초기 조회 대기에는 밴드 연결·미착용 모두 접속 미확인이다',async()=>{
  io.fetch.mockImplementation(()=>new Promise(()=>undefined));await act(async()=>root.render(<Harness band/>));
  expect(box.textContent).toContain('접속 확인 중');expect(box.textContent).not.toContain('연결됨');
  await act(async()=>root.render(<Harness mixed/>));expect(box.textContent).toContain('접속 확인 중');expect(box.textContent).not.toContain('밴드 없이 참여');
});
it('회차가 바뀐 첫 렌더부터 이전 회차의 참여 버전과 행을 반환하지 않는다',async()=>{
  const seen:Array<{route:string;version:number;ids:string[]}>=[];
  function RouteProbe({sid}:{sid:string}){const state=useParticipationSnapshot({classId:'c',sessionId:sid});seen.push({route:sid,version:state.version,ids:Object.keys(state.participants)});return null;}
  io.fetch.mockResolvedValueOnce(snapshot(50));await act(async()=>root.render(<RouteProbe sid="s"/>));
  io.fetch.mockImplementation(()=>new Promise(()=>undefined));await act(async()=>root.render(<RouteProbe sid="next"/>));
  expect(seen.filter(value=>value.route==='next').every(value=>value.version===-1 && value.ids.length===0)).toBe(true);
});
