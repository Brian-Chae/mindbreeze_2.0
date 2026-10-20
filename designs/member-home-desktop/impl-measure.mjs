// 실제 회원 홈과 셸을 Vite로 제공하고 API만 합성 응답으로 대체한다.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const workspace = resolve('.');
const root = resolve('frontend');
process.chdir(root);
process.env.VITE_API_BASE_URL='http://127.0.0.1:5547/api/v1';
const { build } = await import('../../frontend/node_modules/vite/dist/node/index.js');
const { createServer: httpServer } = await import('node:http');
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {useAuthStore} from '${root}/src/stores/authStore.ts';import {MemberStructureHomePage} from '${root}/src/pages/client/member-structure-home-page.tsx';import '${root}/src/index.css';import '${root}/src/mb-tokens.css';useAuthStore.setState({user:{id:'qa',name:'측정 회원',role:'client',counselors:[{id:'h',name:'이서연',profile_image:null}]},isAuthenticated:true,isInitialized:true});createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,{initialEntries:['/app']},React.createElement(MemberStructureHomePage)));`;
const output = await build({ define:{'process.env.NODE_ENV':JSON.stringify('production')}, root, configFile: resolve(root,'vite.config.ts'), resolve:{alias:{'../design-system/build/outputs/css/tokens.css':resolve(workspace,'design-system/build/outputs/css/tokens.css')}},plugins:[{name:'측정-진입점',enforce:'pre',resolveId(id){if(id===resolve(root,'__measure_entry.ts'))return id;},load(id){if(id===resolve(root,'__measure_entry.ts'))return entry;}}],build:{write:false,lib:{entry:resolve(root,'__measure_entry.ts'),formats:['es'],fileName:'measure'},minify:false}});
const files=(Array.isArray(output)?output:[output]).flatMap(result=>result.output);
const server=httpServer((req,res)=>{const file=files.find(f=>'/'+f.fileName===req.url);if(!file){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.fileName.endsWith('.css')?'text/css':'application/javascript');res.end(file.code??file.source);});
let browser;
const rows = [];
try {
await new Promise(r=>server.listen(5547,'127.0.0.1',r));
browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text());});
let count = 3, state = 'success';
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
await page.route('**/*', async route => {
 const url = new URL(route.request().url());
 if (url.hostname !== '127.0.0.1') return route.abort();
 if (url.pathname === '/__measure') return route.fulfill({ contentType: 'text/html', body: `<html><head>${files.filter(f=>f.fileName.endsWith('.css')).map(f=>'<link rel="stylesheet" href="/'+f.fileName+'">').join('')}</head><body><div id="root"></div><script type="module" src="/${files.find(f=>f.type==='chunk'&&f.isEntry).fileName}"></script></body></html>` });
 if (url.pathname.startsWith('/api/')) {
  if(state==='legacy-error'&&url.pathname.endsWith('/sessions')) return route.fulfill({status:503,json:{detail:'측정 오류'}});
  if(state==='legacy-loading'&&url.pathname.endsWith('/sessions')) await new Promise(r=>setTimeout(r,1500));
  if(url.pathname.endsWith('/client/counselors')) return route.fulfill({json:[{id:'h',name:'이서연',profile_image:null}]});
  if (/\/classes\/?$/.test(url.pathname)) {
   if(state==='error') return route.fulfill({status:503,json:{detail:'측정 오류'}});
   if(state==='loading') { await new Promise(r=>setTimeout(r,1500)); return route.fulfill({json:{classes:[],total:0}}); }
   const classes=Array.from({length:state==='empty'?0:count},(_,i)=>({id:`c${i}`,area:'meditation',title:i%2?'일상 속 스트레스 돌봄과 깊은 이완을 위한 명상':'호흡 명상',status:'active',schedule_mode:'fixed',planned_session_count:8,progress:{completed:3,total:8},session_count:8,has_open_session:false,next_session:{id:`s${i}`,seq:4,scheduled_at:'2099-10-20T20:00:00+09:00',status:'scheduled',host:{id:'h',name:'이서연'}}}));
   return route.fulfill({json:{classes,total:classes.length}});
  }
  return route.fulfill({json:{sessions:[],reports:[],rooms:[],notifications:[],counselors:[{id:'h',name:'이서연',profile_image:null}],total:0,unread:0}});
 }
 return route.continue();
});
for(const width of [1280,1440,1920,834,390]) for(const mode of ['1','2','3','7','empty','error','loading','legacy-error','legacy-loading']) {
 count=Number(mode)||3;state=/^\d+$/.test(mode)?'success':mode;
 await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5547/__measure');
 await page.locator('.mh-home').waitFor({timeout:10000}).catch(async e=>{console.error(await page.locator('body').innerText());throw e;});
 if(state==='success'||state.startsWith('legacy-')) await page.locator('.mh-track .mc-card').first().waitFor().catch(async e=>{console.error(await page.locator('body').innerText());throw e;});
 else await page.locator(`.mh-classes [role="${state==='error'?'alert':'status'}"]`).waitFor();
 await page.locator(state.startsWith('legacy-')?'.mh-legacy-state':'.mh-summary').waitFor();
 const data=await page.evaluate(()=>{
 const rect=s=>(document.querySelector(s)??document.querySelector('.mh-legacy-state')).getBoundingClientRect();const h=rect('[data-testid="class-hero"]'),m=rect('.mh-main'),r=rect('.mh-rail>section');
 const track=document.querySelector('.mh-track');
 return { overflow:document.documentElement.scrollWidth-innerWidth, align:innerWidth>=1024?Math.max(Math.abs(h.left-m.left),Math.abs(h.right-r.right)):null, mainWidth:rect('.mh-home').width, heroWidth:h.width, widths:[...new Set([...document.querySelectorAll('.mh-track .mc-card')].map(e=>e.getBoundingClientRect().width))],heights:[...new Set([...document.querySelectorAll('.mh-track .mc-card')].map(e=>e.getBoundingClientRect().height))],tiles:[...new Set([...document.querySelectorAll('.mh-summary>button')].map(e=>e.getBoundingClientRect().height))],snap:track?getComputedStyle(track).scrollSnapType:null, counseling:!!document.querySelector('[aria-label="내 상담"]')};
 });
 let keyboard=true,buttons=true;
 if(state==='success'&&width>=1024){
 buttons=await page.getByRole('button',{name:'이전 클래스',exact:true}).isDisabled();
 await page.locator('.mh-track a').first().focus();for(let i=1;i<count;i++)await page.keyboard.press('Tab');
 keyboard=await page.locator('.mh-track a').last().evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.mh-track').getBoundingClientRect();return document.activeElement===el&&a.left>=b.left&&a.right<=b.right;});
 
 await page.locator('.mh-track').evaluate(el=>el.scrollLeft=el.scrollWidth);await page.waitForTimeout(100);
 buttons=buttons&&await page.getByRole('button',{name:'다음 클래스',exact:true}).isDisabled();
 }
 const pass=data.overflow===0&&!data.counseling&&keyboard&&buttons&&(width<1024||(data.align===0&&data.widths.every(w=>w===280)&&data.heights.every(h=>h===304)&&(state.startsWith('legacy-')||data.tiles.length===1&&data.tiles[0]===152)));
 rows.push({width,mode,...data,keyboard,buttons,pass});console.log(width,mode,pass,JSON.stringify(data));
}
writeFileSync(workspace+'/designs/member-home-desktop/impl-measure-results.json',JSON.stringify({rows,errors},null,2));
writeFileSync(workspace+'/designs/member-home-desktop/impl-measure.md',`# 회원 홈 B안 실제 컴포넌트 DOM 측정\n\n측정: ${new Date().toISOString()}\n\n실행: \`node designs/member-home-desktop/impl-measure.mjs\`\n\n실제 MemberStructureHomePage·ClientHomePage·StructureShell을 Vite로 제공하고 API만 합성 응답으로 대체했다. Playwright Chromium, 높이 1000px. 이미지 평가 없음. 서버와 브라우저는 실행 종료 시 닫는다. 외부 히어로 이미지 요청은 차단하며, DOM 구조·치수만 평가했다. legacy-error·legacy-loading은 기존 세션/리포트 영역의 실패·로딩을 별도로 재현한다.\n\n${rows.filter(r=>r.pass).length}/${rows.length} 통과. 브라우저 오류: ${JSON.stringify(errors)}\n\n${rows.map(r=>`- ${r.width}px / ${r.mode}: ${r.pass?'통과':'실패'}, 페이지 넘침 ${r.overflow}px, 정렬 오차 ${r.align??'기존 배치'}px, main ${r.mainWidth}px, 카드 폭 ${r.widths.join('/')}px·높이 ${r.heights.join('/')}px, 타일 높이 ${r.tiles.join('/')}px, Tab ${r.keyboard}, 끝 버튼 ${r.buttons}`).join('\n')}\n\n데스크톱은 공통 main 최대 1280px(좌우 패딩 포함), 카드 280×304px, 간격 16px, 타일 152px, 스냅 x mandatory를 적용했다. 834·390px는 기존 격자와 순서를 유지한다. 터치·실물 트랙패드 제스처와 실제 서버 데이터는 이번 합성 API DOM 측정의 검증 범위 밖이다.\n`);
if(rows.some(r=>!r.pass)||errors.length)process.exitCode=1;
} finally { await browser?.close();await new Promise(r=>server.close(r)); }
