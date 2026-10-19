// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useEntryPrep } from '../src/hooks/useEntryPrep';
import { NoticeStepView } from '../src/components/class/flow/member/NoticeStepView';
const save = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('../src/lib/api/class-flow', () => ({ setReportChoice: save, setResearchConsent: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, 'matchMedia', {value: () => ({matches:true}), configurable:true});
it.each([['meditation', 'class-team-v1'], ['clinical', 'r5-1'], [undefined, 'r5-1']])('고지 저장 유형 %s', async (sessionType, version) => {
 const box = document.createElement('div'); const root = createRoot(box);
 function Prep() { const prep = useEntryPrep({ sessionId:'s', credential:'c', participantId:'p', sessionType }); return <button onClick={() => void prep.commitReportChoice()}>확인</button>; }
 await act(async () => root.render(<Prep/>)); await act(async () => box.querySelector('button')!.click());
 expect(save).toHaveBeenLastCalledWith('s','c',expect.objectContaining({noticeVersion:version,noticeAcknowledged:true,reportIncluded:false}));
 await act(async()=>root.unmount());
});
it('명상 고지는 강사팀 참관·사후 열람과 원본 제외를 표시한다', async () => {
 const box=document.createElement('div');const root=createRoot(box); const noop=()=>undefined;
 await act(async()=>root.render(<NoticeStepView sessionType="meditation" place="online" size="group" bandMode="none" title="명상" hostName={null} retentionDays={90} reportChoice={null} researchConsent={false} researchSaveFailed={false} steps={{total:5,current:0}} onReportChoice={noop} onResearchChange={noop} onNext={noop} onBack={noop} onExit={noop}/>));
 expect(box.textContent).toContain('이 클래스의 진행 지도사와 등록된 다른 지도사는'); expect(box.textContent).toContain('참관'); expect(box.textContent).toContain('전사 원문');
 await act(async()=>root.unmount());
});
