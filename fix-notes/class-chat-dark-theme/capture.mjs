// 실행: cd frontend && npm run build 후 저장소 루트에서 node fix-notes/class-chat-dark-theme/capture.mjs
// 설치된 frontend/node_modules를 사용한다. 외부 API·소켓 요청은 mock/차단한다.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync, readdirSync } from 'node:fs';
const require = createRequire(resolve('frontend/package.json'));
const { createServer } = await import(require.resolve('vite'));
const react = (await import(require.resolve('@vitejs/plugin-react'))).default;
const { chromium } = require('playwright');
const out = resolve('fix-notes/class-chat-dark-theme');
const css = readdirSync('frontend/dist/assets').find(f=>f.endsWith('.css'));
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import '/src/mb-tokens.css';
import '/src/components/class/flow/shell/shell-kit.css';
import '/src/components/class/flow/host/host-flow-base.css';
import '/src/components/class/flow/host/host-flow-live.css';
import {ChatSheet} from '/src/components/class/player/host/sheets/ChatSheet';
import {ClassChatPanel} from '/src/components/chat/ClassChatPanel';
import {ChatSheetBody} from '/src/components/class/flow/host/LobbySheets';
import {PlayerSheet} from '/src/components/class/player/shared/PlayerSheet';
import ClientChatPage from '/src/pages/client/ClientChatPage';
import {useAuthStore} from '/src/stores/authStore';
import {useChatStore} from '/src/stores/chatStore';
const light=location.pathname.startsWith('/app'); const variant=new URLSearchParams(location.search).get('variant');
useAuthStore.setState({isAuthenticated:true,accessToken:null,user:{id:'me',name:'샘플 회원',role:'client',email:'sample@example.invalid',counselors:[]}});
useChatStore.setState({rooms:[{id:'room',room_type:'session',name:'샘플 클래스',participant_count:2,unread_count:0}],messagesByRoom:{}});
const panel=<ClassChatPanel sessionId="sample" roomId="room" enabled collapsed={false} onCollapsedChange={()=>{}} embedded/>;
createRoot(document.getElementById('root')).render(light ? <BrowserRouter><ClientChatPage/></BrowserRouter> : <div className="sh-scope pz-root" style={{height:'100dvh',background:'#1b0f2a'}}><PlayerSheet open title="채팅" tall onClose={()=>{}}>{variant==='host-live'?<ChatSheet enabled busy={false} onToggleEnabled={()=>{}} room={panel}/>:variant==='member'?panel:<ChatSheetBody enabled node={panel} messages={[]} draft="" onDraft={()=>{}} onToggle={()=>{}} onSend={()=>{}}/>}</PlayerSheet></div>);
`;
const server = await createServer({root:resolve('frontend'),configFile:false,envDir:'/tmp/mb-no-env',resolve:{dedupe:['react','react-dom']},plugins:[react(),{name:'chat-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]==='/fixture.tsx'){res.setHeader('Content-Type','application/javascript');s.transformRequest('/virtual-chat-fixture.tsx').then(r=>res.end(r.code));}else if(req.url?.split('?')[0]==='/'||req.url?.startsWith('/app/chat/')){res.setHeader('Content-Type','text/html');s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/dist/assets/'+css+'"></head><body><div id="root"></div><script type="module" src="/virtual-chat-fixture.tsx"></script></body></html>').then(h=>res.end(h));}else next();});},resolveId(id){if(id==='/virtual-chat-fixture.tsx')return id;},load(id){if(id==='/virtual-chat-fixture.tsx')return fixture;}}],server:{host:'127.0.0.1',port:5199}});
await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log(e.message);});
let populated=false;
await page.route('**/*', async route=>{
 const url=new URL(route.request().url());
 if(url.pathname.startsWith('/api/')){
  const messages=populated?[{id:'mine',room_id:'room',sender_id:'me',type:'text',content:'함께해 주셔서 감사합니다.',created_at:'2026-10-22T01:02:00Z'}, {id:'peer',room_id:'room',sender_id:'peer',sender_name:'샘플 상담사',type:'text',content:'편안하게 호흡해 보세요.',created_at:'2026-10-22T01:01:00Z'}, {id:'system',room_id:'room',type:'system',content:'샘플 클래스 채팅',created_at:'2026-10-22T01:00:00Z'}]:[];
  const data=url.pathname.endsWith('/messages')?{messages,next_cursor:null}:url.pathname.endsWith('/rooms')?{rooms:[{id:'room',room_type:'session',name:'샘플 클래스',participant_count:2,unread_count:0}]}:{notifications:[],unread_count:0};
  return route.fulfill({json:data});
 }
 if(url.hostname!=='127.0.0.1')return route.abort();
 return route.continue();
});
const measurements=[];
async function capture(name,path='/'){
 await page.goto('http://127.0.0.1:5199'+path);await page.locator('.chat-room textarea').waitFor({state:'attached',timeout:10000});
 await page.waitForTimeout(700);
 if(name.includes('typing')) { await page.locator('textarea').fill('오늘 수업 감사합니다'); await page.waitForTimeout(350); }
 await page.screenshot({path:out+'/'+name+'.png',fullPage:true});
 measurements.push(await page.evaluate(name=>{
  const root=document.querySelector('.chat-room');const input=root.querySelector('textarea');const send=root.querySelector('.chat-room__send');
  const rgba=c=>{const n=c.match(/[\d.]+/g)?.map(Number)??[0,0,0];return [n[0],n[1],n[2],n[3]??1];};
  const over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
  const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const bg=e=>{const chain=[];for(let p=e;p;p=p.parentElement)chain.unshift(p);return chain.reduce((b,p)=>over(rgba(getComputedStyle(p).backgroundColor),b),[255,255,255]);};
  const textContrast=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){const n=walker.currentNode;if(!n.textContent.trim())continue;const e=n.parentElement;const b=bg(e);textContrast.push({text:n.textContent.trim(),color:getComputedStyle(e).color,background:b.map(Math.round),ratio:Number(contrast(over(rgba(getComputedStyle(e).color),b),b).toFixed(2))});}
  const style=e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,border:getComputedStyle(e).borderColor});
  return {name,tone:root.dataset.chatTone,root:style(root),input:style(input),placeholder:getComputedStyle(input,'::placeholder').color,placeholderContrast:Number(contrast(rgba(getComputedStyle(input,'::placeholder').color).slice(0,3),bg(input)).toFixed(2)),send:style(send),overflow:document.documentElement.scrollWidth>innerWidth,textContrast};
 },name));
}
try{
 await capture('class-empty'); populated=true;
 await capture('class-messages');await capture('class-host-live','/?variant=host-live');await capture('class-member','/?variant=member');await capture('class-typing');await capture('general-light','/app/chat/room');
 if(measurements.some(m=>m.name.startsWith('class')&&(m.tone!=='dark'||m.root.background==='rgb(255, 255, 255)')))throw Error('클래스 테마 회귀');
 if(measurements.at(-1).root.background!=='rgb(255, 255, 255)')throw Error('일반 테마 회귀');
 if(measurements.filter(m=>m.tone==='dark').some(m=>m.textContrast.some(t=>t.ratio<4.5)))throw Error('본문 WCAG AA 대비 미달');
 writeFileSync(out+'/computed-styles.json',JSON.stringify({measurements,errors},null,2));
 console.log(JSON.stringify({measurements,errors},null,2));
}catch(e){console.log(errors);await page.screenshot({path:'/tmp/mb-chat-capture-debug.png',fullPage:true});throw e;}finally{await browser.close();await server.close();}
