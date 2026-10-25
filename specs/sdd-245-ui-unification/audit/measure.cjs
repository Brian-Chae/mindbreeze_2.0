// 감사 도구일 뿐 제품 구현이 아니다. 모든 요청을 가로채며 실서버에는 연결하지 않는다.
const fs=require('node:fs'),path=require('node:path');
const crypto=require('node:crypto');
const fontCache=path.join(require('node:os').tmpdir(),'sdd245-font-cache');fs.mkdirSync(fontCache,{recursive:true});
const root=path.resolve(__dirname,'../../..');
const {chromium}=require(path.join(root,'frontend/node_modules/playwright'));
const {fixture,userFor}=require('./base-fixtures.cjs');
const extraFixture=(...args)=>fs.existsSync(path.join(__dirname,'extra-fixtures.cjs'))?require('./extra-fixtures.cjs').extraFixture(...args):undefined;
const build=JSON.parse(fs.readFileSync(path.join(__dirname,'build-info.json')));
const home={client:'/app',counselor:'/dashboard',org_admin:'/dashboard/org',platform_admin:'/admin/orgs'};
const src=fs.readFileSync(path.join(root,'frontend/src/App.tsx'),'utf8');
const routeBlocks=[...src.matchAll(/<Route\s+path="([^"]+)"([\s\S]*?)(?=<Route\s|$)/g)];
const roles=['client','counselor','org_admin','platform_admin'];
let manifest=routeBlocks.map(m=>{
 const block=m[2].split('\n        {/*')[0];
 const r=block.match(/<RoleGuard role=(?:"([^"]+)"|\{\[([^\]]+)\]\})/);
 let access=r?(r[1]?[r[1]]:[...r[2].matchAll(/'([^']+)'/g)].map(x=>x[1])):block.includes('<PlatformAdminRoute>')?['platform_admin']:block.includes('<RoleGuard>')?roles:['public'];
 // 비가드 경로도 해당 제품 역할로 확인한다. 공개 진입은 별도 public 컨텍스트다.
 if(m[1].startsWith('/onboarding/'))access=[m[1].includes('counselor')?'counselor':'client'];
 if(/^\/org\/(search|:org_id)/.test(m[1])||m[1]==='/membership-invite')access=['counselor','org_admin'];
 if(/^\/sessions\/:id\/(live|player|record)/.test(m[1]))access=['client','counselor','org_admin'];
 if(m[1].startsWith('/design'))access=['counselor'];
 return {pattern:m[1],roles:access,line:src.slice(0,m.index).split('\n').length,source:'frontend/src/App.tsx',redirect:/<Navigate|<Legacy|<RoleRouter|<SessionLivePage/.test(block)};
});
const nested=['/app/chat','/app/chat/sample-room','/app/chat/lucy','/app/ai','/app/profile','/app/participation-profile','/app/sessions/sample-session','/app/reports','/app/notifications'];
manifest.push(...nested.map(pattern=>({pattern,roles:['client'],source:'frontend/src/pages/client/ClientAppPage.tsx',redirect:pattern==='/app/ai'})));
// 데이터가 있는 리포트 다이얼로그와 몰입 화면의 정상 fixture를 보조 표본으로 포함한다.
manifest.push({pattern:'/app/reports?report=sample-report',roles:['client'],source:'frontend/src/pages/client/ClientReportListPage.tsx',supplement:true}, {pattern:'/design/class-player?role=member&case=M02',roles:['client'],source:'frontend/src/pages/design/ClassPlayerCasesPage.tsx',supplement:true});
manifest.push({pattern:'/report-view?token=synthetic-view-token',roles:['public'],source:'frontend/src/pages/reports/ReportViewPage.tsx',supplement:true},{pattern:'/membership-invite?token=synthetic-invite-token',roles:['counselor','org_admin'],source:'frontend/src/pages/MembershipInvitePage.tsx',supplement:true},{pattern:'/set-password?token=synthetic-token',roles:['public'],source:'frontend/src/pages/SetPasswordPage.tsx',supplement:true},{pattern:'/reset-password?token=synthetic-token',roles:['public'],source:'frontend/src/pages/ResetPasswordPage.tsx',supplement:true});
function concrete(p){if(p==='*')return '/audit-unknown';return p.replace(':targetType','credential').replace(':classId','sample-class').replace(':relationshipId','sample-relationship').replace(':sessionId','sample-session').replace(':roomId','sample-room').replace(':org_code','SAMPLE').replace(':org_id','sample-org').replace(':token','sample-token').replace(':id',p.startsWith('/clients')?'sample-client':p.startsWith('/reports')?'sample-report':p.startsWith('/admin')?'sample-review':'sample-session').replace('*','audit-unknown');}
const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.html':'text/html','.jpg':'image/jpeg','.json':'application/json'};
function collect(){
 const visible=el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&r.width>0&&r.height>0&&!el.closest('[aria-hidden="true"],[inert]');};
 const sel=el=>{const a=[];while(el&&el!==document.body){const sib=[...el.parentElement.children].filter(x=>x.tagName===el.tagName);a.unshift(el.tagName.toLowerCase()+`:nth-of-type(${sib.indexOf(el)+1})`);el=el.parentElement;}return 'body > '+a.join(' > ');};
 const val=el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect();return {selector:sel(el),tag:el.tagName,class:typeof el.className==='string'?el.className:'',text:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().slice(0,100),x:r.x,y:r.y,width:r.width,height:r.height,maxWidth:c.maxWidth,paddingLeft:parseFloat(c.paddingLeft),paddingRight:parseFloat(c.paddingRight),paddingTop:parseFloat(c.paddingTop),paddingBottom:parseFloat(c.paddingBottom),marginTop:parseFloat(c.marginTop),marginBottom:parseFloat(c.marginBottom),radius:c.borderRadius,shadow:c.boxShadow,border:c.border,borderWidth:c.borderWidth,borderColor:c.borderColor,fontSize:parseFloat(c.fontSize),fontWeight:c.fontWeight,fontFamily:c.fontFamily,lineHeight:c.lineHeight,color:c.color,background:c.backgroundColor,gap:c.gap,rowGap:c.rowGap,columnGap:c.columnGap};};
 const all=[...document.body.querySelectorAll('*')].filter(visible);
 const first=s=>[...document.querySelectorAll(s)].find(visible);
 const shell=first('[data-mobile-swipe-page]');
 const content=shell||first('main')||first('#root > div');
 const wrappers=all.filter(e=>(e===content||content?.contains(e))&&(e.matches('main,section,article')||e.parentElement===content||(e.matches('div')&&getComputedStyle(e).maxWidth!=='none')||/home|page|container|wrapper|content|layout|stack|cs-class-list/.test(typeof e.className==='string'?e.className:''))).map(val);
 const title=first('[data-mobile-swipe-title]')||first('section > header.hidden > div > div.font-bold')||first('h1')||first('h2');
 const headings=all.filter(e=>e.matches('h1,h2,h3,[data-mobile-swipe-title]')).map(val);
 const controls=all.filter(e=>e.matches('button,a[href],[role=button],[role=tab]')).map(e=>{
 const v=val(e);const transparent=/rgba\([^)]*, 0\)|transparent/.test(v.background);const primary=/(95, 0, 128|110, 26, 140|91, 33, 182)/.test(v.background)||/(primary|hcta|btn--pri)/.test(v.class);
 const kind=e.matches('[role=tab]')?'tab':!v.text&&e.querySelector('svg')||e.getAttribute('aria-label')&&e.querySelector('svg')&&!e.textContent.trim()?'icon':primary?'primary':!transparent?'secondary':'ghost';return {...v,kind,disabled:e.matches(':disabled'),inContent:!!content?.contains(e)};});
 const cards=all.filter(e=>(content?.contains(e)||!shell)&&!e.matches('button,a,input,select,textarea,svg,path')&&(/card|panel|tile/.test(typeof e.className==='string'?e.className:'')||(parseFloat(getComputedStyle(e).borderRadius)>=8&&e.getBoundingClientRect().width>150&&e.getBoundingClientRect().height>60))).map(val);
 const inputs=all.filter(e=>e.matches('input:not([type=hidden]),select,textarea,[role=combobox]')).map(val);
 const chips=all.filter(e=>e.matches('[role=tab]')||/badge|chip|pill/.test(typeof e.className==='string'?e.className:'')).map(val);
 const sections=all.filter(e=>e.matches('section,article')||e.parentElement===content).map(e=>{const v=val(e),next=e.nextElementSibling;return {...v,nextVerticalGap:next&&visible(next)?next.getBoundingClientRect().top-e.getBoundingClientRect().bottom:null};});
 return {content:content?val(content):null,title:title?{...val(title),topFromContainer:title.getBoundingClientRect().top-(content?.getBoundingClientRect().top||0)}:null,wrappers,headings,controls,cards,inputs,chips,sections,scrollWidth:document.documentElement.scrollWidth,bodyText:document.body.innerText.slice(0,250),shell:!!shell};
}
(async()=>{
 fs.mkdirSync(path.join(__dirname,'captures'),{recursive:true});fs.mkdirSync(path.join(__dirname,'measurements'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'routes.json'),JSON.stringify(manifest,null,2));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const allResults=[];const filter=process.env.AUDIT_FILTER?new RegExp(process.env.AUDIT_FILTER):null;
 try{
 for(const width of [390,1440]) for(const item of manifest) for(const role of item.roles){
 const url=concrete(item.pattern), id=`${role}-${width}-${url.replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'')||'landing'}`;
 if(filter&&!filter.test(id))continue;
 if(process.env.AUDIT_RESUME&&fs.existsSync(path.join(__dirname,'measurements',id+'.json')))continue;
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:1,serviceWorkers:'block',locale:'ko-KR',timezoneId:'Asia/Seoul'});
 const page=await context.newPage();const errors=[],unknown=[],blockedWrites=[],fontRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({role,user})=>{if(role!=='public')localStorage.setItem('mb_user',JSON.stringify(user));}, {role,user:userFor(role)});
 await context.routeWebSocket('**/*',socket=>socket.close());
 await context.route('**/*',async route=>{
 const u=new URL(route.request().url()),p=u.pathname,method=route.request().method();
 if(p.startsWith('/api/')){
 if(method==='OPTIONS')return route.fulfill({status:204});
 if(method!=='GET'&&!p.endsWith('/auth/refresh')){blockedWrites.push({method,path:p});return route.fulfill({status:405,json:{detail:'audit read-only'}});}
 const data=extraFixture(p,role)??fixture(p,role);
 if(data===undefined)unknown.push(p);
 return route.fulfill({status:data===undefined?404:200,json:data??{detail:'audit fixture not registered'}});
 }
 const fontAllowed=method==='GET'&&((u.hostname==='cdn.jsdelivr.net'&&p.startsWith('/gh/orioncactus/pretendard@v1.3.9/'))||(u.hostname==='fonts.googleapis.com'&&p==='/css2')||(u.hostname==='fonts.gstatic.com'&&/^\/s\/(notosanskr|fraunces|inter|jetbrainsmono)\//.test(p)));
 if(fontAllowed){
 const key=crypto.createHash('sha256').update(u.href).digest('hex'),cached=path.join(fontCache,key);
 try{if(!fs.existsSync(cached)){const data=require('node:child_process').execFileSync('curl',['-L','--fail','--silent','--max-time','15',u.href],{maxBuffer:32*1024*1024});fs.writeFileSync(cached,data);}
 const body=fs.readFileSync(cached);fontRequests.push({url:u.href,sha256:crypto.createHash('sha256').update(body).digest('hex'),bytes:body.length});
 return route.fulfill({contentType:p.endsWith('.css')||u.hostname==='fonts.googleapis.com'?'text/css':p.endsWith('.ttf')?'font/ttf':'font/woff2',headers:{'access-control-allow-origin':'*'},body});
 }catch{fontRequests.push({url:u.href,error:'font fetch failed'});return route.abort();}
 }
 if(u.hostname!=='sdd245.local')return route.abort();
 let file=path.join(build.outDir,decodeURIComponent(p));
 if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(build.outDir,'index.html');
 return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
 });
 const debug=message=>{if(process.env.AUDIT_DEBUG)console.log(id,message);};
 let failure=null;debug('goto');
 try{await page.goto('https://sdd245.local'+url,{waitUntil:'networkidle',timeout:20000});debug('fonts');await page.evaluate(()=>document.fonts.load('700 22px \"Pretendard Variable\"','안녕하세요'));await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('font ready timeout')),10000))]));debug('fonts-ready');await page.waitForTimeout(120);}catch(e){failure=e.message;}
 debug('collect');let metrics; try { metrics=await page.evaluate(collect); } catch { await page.waitForTimeout(700); metrics=await page.evaluate(collect).catch(e=>({failure:e.message,controls:[]})); }
 debug('fontfaces');metrics.fontFaces=await page.evaluate(()=>[...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family,status:f.status,weight:f.weight})));
 debug(JSON.stringify(metrics.fontFaces));debug('hover');const hover=[];
 // 콘텐츠 우선, 역할마다 네 가지 대표 variant의 실제 pointer hover를 측정한다.
 for(const kind of ['primary','secondary','ghost','icon']){
 const candidates=metrics.controls.filter(x=>x.kind===kind&&!x.disabled&&x.height<=64);
 const target=candidates.find(x=>x.inContent)||candidates[0];
 if(!target){hover.push({kind,status:'not-present'});continue;}
 try{const el=page.locator(target.selector);await el.hover({timeout:1200});await page.waitForTimeout(180);const style=await el.evaluate(e=>{const c=getComputedStyle(e);return {background:c.backgroundColor,color:c.color,border:c.border,shadow:c.boxShadow,radius:c.borderRadius};});hover.push({kind,selector:target.selector,normal:{background:target.background,color:target.color,border:target.border,shadow:target.shadow,radius:target.radius},hover:style});}catch{hover.push({kind,selector:target.selector,status:'not-hoverable'});}
 }
 await page.mouse.move(0,0);await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0;});});await page.waitForTimeout(180);
 await page.screenshot({path:path.join(__dirname,'captures',id+'.png'),fullPage:false});
 const actual=new URL(page.url()).pathname;
 const result={id,fixtureRevision:3,pattern:item.pattern,url,role,width,height:width===390?844:900,home:home[role]||null,actual,redirected:actual!==url.split('?')[0],failure,errors,unknown:[...new Set(unknown)],blockedWrites,fontRequests,hover,...metrics};
 fs.writeFileSync(path.join(__dirname,'measurements',id+'.json'),JSON.stringify(result,null,2));allResults.push(result);
 console.log(JSON.stringify({id,title:metrics.title?.text,errors,unknown:result.unknown,redirected:result.redirected}));
 await context.close();
 }
 fs.writeFileSync(path.join(__dirname,'run-info.json'),JSON.stringify({browser:await browser.version(),channel:'chrome',build,completedAt:new Date().toISOString(),manifestCount:manifest.length,captures:fs.readdirSync(path.join(__dirname,'measurements')).length},null,2));
 }finally{await browser.close();}
})();
