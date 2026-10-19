// @vitest-environment jsdom
import {act} from 'react';import {createRoot} from 'react-dom/client';import {expect,it,vi} from 'vitest';
import {ClassTeamRecord} from '../src/components/class/structure/class-team-record';
const get=vi.hoisted(()=>vi.fn().mockResolvedValue({ai_summary:{headline:'함께한 명상',sections:{}},counselor_notes:'수업 메모',transcript:'노출 금지 원문',edit_history:[{body:'노출 금지 이력'}]}));
vi.mock('../src/lib/api/audio',()=>({getRecord:get}));Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
it('팀 기록은 명시 조회 후 요약·메모만 읽고 원문·편집·저장 UI가 없다',async()=>{const box=document.createElement('div');const root=createRoot(box);await act(async()=>root.render(<ClassTeamRecord sessionId="s"/>));expect(get).not.toHaveBeenCalled();await act(async()=>box.querySelector('button')!.click());expect(get).toHaveBeenCalledWith('s');expect(box.textContent).toContain('수업 메모');expect(box.textContent).not.toContain('노출 금지');expect(box.querySelector('textarea')).toBeNull();expect(box.querySelector('audio')).toBeNull();await act(async()=>root.unmount());});
