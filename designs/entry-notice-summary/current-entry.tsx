import React, {useState} from '../../frontend/node_modules/react';
import {createRoot} from '../../frontend/node_modules/react-dom/client';
import {NoticeStepView} from '../../frontend/src/components/class/flow/member/NoticeStepView';
function Current(){const [report,setReport]=useState<'included'|'excluded'|null>('excluded');const [research,setResearch]=useState(false);return <NoticeStepView sessionType="meditation" place="online" size="group" bandMode="opt" title="마음챙김 명상 · 4회차" hostName="채용욱" retentionDays={90} reportChoice={report} researchConsent={research} researchSaveFailed={false} steps={{total:5,current:0}} backdropSrc="assets/background.webp" onReportChoice={setReport} onResearchChange={setResearch} onNext={()=>{}} onBack={()=>{}} onExit={()=>{}}/>};
createRoot(document.getElementById('root')!).render(<Current/>);
