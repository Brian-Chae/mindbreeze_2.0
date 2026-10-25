// 합성 fixture 전체 라우트에서 헤더 액션의 실제 계산 스타일을 독립 검증한다.
const fs = require('node:fs'), path = require('node:path');
const dirs = process.argv.slice(2);
const rows = dirs.flatMap(dir => fs.readdirSync(path.join(dir,'measurements')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,'measurements',n)))));
const failures=[]; const evaluated=[];
for(const row of rows){
 const h=row.pageHeader; if(!h){
  const immersiveChat=row.width===390 && /^\/(app\/)?chat\//.test(row.actual);
  if(row.shell && !immersiveChat)failures.push({id:row.id,rule:'AppShell 헤더 측정 누락',actual:row.title});
  continue;
 }
 evaluated.push(row);const fail=(rule,actual)=>failures.push({id:row.id,rule,actual});
 if(row.failure || row.errors.length) fail('화면 실행 오류',row.failure||row.errors);
 if(!h.title || h.title.fontSize!==22 || h.title.fontWeight!=='700')fail('제목 22/700',h.title);
 const actions=h.actions; let primarySeen=false;
 if(actions.filter(a=>a.role==='primary').length>1)fail('주 액션 최대 1개',actions.map(a=>a.text));
 for(const a of actions){
 if(Math.abs(a.height-44)>0.1)fail('액션 높이 44',a);
 if(parseFloat(a.radius)<999)fail('액션 pill',a);
 const primary=a.role==='primary';if(primary)primarySeen=true;else if(primarySeen)fail('보조 다음 주 DOM 순서',a.text);
 if(a.background!==(primary?'rgb(95, 0, 128)':'rgb(255, 255, 255)'))fail('액션 배경',a);
 if(!primary && (a.borderColor!=='rgb(95, 0, 128)' || a.borderWidth!=='1px'))fail('보조 보라 테두리 1px',a);
 const sameRow=h.title && a.y<h.title.y+h.title.height && a.y+a.height>h.title.y;
 if(sameRow && Math.abs(a.titleCenterDelta)>1)fail('제목 대비 세로 중심 ±1px',a);
 }
 if(actions.length>1 && actions[0].y>=h.title.y+h.title.height){
  if(actions.some(a=>Math.abs(a.y-actions[0].y)>1 || Math.abs(a.width-actions[0].width)>1))fail('줄바꿈 시 같은 폭·행',actions);
 }
}
const summary=[390,1440].map(width=>({width,total:rows.filter(r=>r.width===width).length,pageHeaders:evaluated.filter(r=>r.width===width).length,actionHeaders:evaluated.filter(r=>r.width===width&&r.pageHeader.actions.length).length,actions:evaluated.filter(r=>r.width===width).reduce((n,r)=>n+r.pageHeader.actions.length,0),mismatches:failures.filter(f=>rows.find(r=>r.id===f.id)?.width===width).length}));
console.log(JSON.stringify({summary,failures,withoutPageHeader:rows.filter(r=>!r.pageHeader).map(r=>({id:r.id,pattern:r.pattern,redirected:r.redirected,title:r.title?.text})),evaluatedIds:evaluated.map(r=>r.id)},null,2));
process.exitCode=failures.length?1:0;
