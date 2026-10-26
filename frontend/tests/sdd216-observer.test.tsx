// @vitest-environment jsdom
import {act,type ReactNode} from 'react';import {createRoot} from 'react-dom/client';import {expect,it,vi} from 'vitest';
import {ClassObserverView} from '../src/components/class/structure/class-observer-view';
const api=vi.hoisted(()=>({observe:vi.fn().mockResolvedValue({token:'test',room_name:'room',snapshot:{status:'open'}}),props:vi.fn()}));
vi.mock('../src/lib/api/class-operations',()=>({classOperationsApi:api}));
vi.mock('@livekit/components-react',()=>({LiveKitRoom:(props:{children:ReactNode})=>{api.props(props);return <div>{props.children}</div>;},RoomAudioRenderer:()=>null,VideoTrack:()=>null,useTracks:()=>[]}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
it('서버 참관 허가 후에도 음성·영상·화면 송출과 EEG 제어를 제공하지 않는다',async()=>{const box=document.createElement('div');const root=createRoot(box);await act(async()=>root.render(<ClassObserverView classId="c" sessionId="s"/>));expect(api.observe).not.toHaveBeenCalled();await act(async()=>box.querySelector('button')!.click());expect(api.observe).toHaveBeenCalledWith('c','s');expect(api.props).toHaveBeenCalledWith(expect.objectContaining({audio:false,video:false,screen:false,token:'test'}));expect(box.querySelector('input')).toBeNull();expect([...box.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['참관 나가기']);await act(async()=>root.unmount());});
