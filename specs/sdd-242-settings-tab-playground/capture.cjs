// 합성 API 응답으로 실제 React 앱을 검증한다. 외부 서버·DB·실제 인증은 사용하지 않는다.
const { chromium } = require(process.cwd() + '/frontend/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.join(process.cwd(), 'specs/sdd-242-settings-tab-playground/captures');
const events = JSON.parse(fs.readFileSync('designs/settings-tab-playground/audit-data.json', 'utf8'));
fs.mkdirSync(out, { recursive: true });
const origin = 'http://127.0.0.1:5182';
async function settleSwitches(page) {
 await page.waitForFunction(() => [...document.querySelectorAll('[data-switch-track]')].every(track => {
  const button = track.closest('button'); const state = document.getElementById(button.getAttribute('aria-describedby'))?.textContent;
  const expected = state === '일부' ? 10 : button.getAttribute('aria-checked') === 'true' ? 20 : 0;
  return Math.abs(new DOMMatrix(getComputedStyle(track.firstElementChild).transform).m41 - expected) < 0.01;
 }));
}
(async () => {
 const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 const results = { fixture: true, checks: [], pageErrors: [], externalRequests: [], writes: [] };
 try {
  for (const width of [390, 1440]) for (const role of ['client','counselor','org_admin','platform_admin']) {
   const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
   const user = { id: `fixture-${role}`, name: '설정 검증 사용자', email: 'sample@example.test', role, verified_tier: 'verified', counselors: [], counselor_code: role === 'counselor' ? 'SAMPLE' : null };
   await context.addInitScript((value) => { localStorage.setItem('mb_user', JSON.stringify(value)); localStorage.setItem('mb_web_push_opt_out', '1'); sessionStorage.setItem(`mb-mobile-menu-swipe-hint:${value.id}:${value.role}`, '1'); }, user);
   let prefs = { email: Object.fromEntries(events.map(e=>[e.key,e.email])), in_app: Object.fromEntries(events.map(e=>[e.key,true])), push: { chat_message: false } };
   let profile = { ...user, id: 'fixture-profile', phone: null, profile_image: null, bio: null, gender: null, birth_date: null, concerns: [], interests: [], specialties: [], qualifications: [], careers: [], version: 1 };
   await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.includes('/api/v1/')) {
     const endpoint = url.pathname.split('/api/v1')[1]; let body = {};
     if (request.method() === 'OPTIONS') return route.fulfill({ status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'} });
     if (!['GET','HEAD'].includes(request.method())) results.writes.push({role,width,endpoint,method:request.method()});
     if (endpoint === '/auth/refresh') body = { access_token: 'synthetic-fixture-token', token_type:'bearer' };
     else if (endpoint === '/notifications/preferences') {
      if (request.method() === 'PUT') { const patch = request.postDataJSON(); assert(!patch.push); for(const channel of ['email','in_app']) prefs[channel] = {...prefs[channel],...patch[channel]}; }
      body = prefs;
     }
     else if (endpoint.includes('/me/profile')) { if(request.method()==='PATCH') profile={...profile,...request.postDataJSON()}; body=profile; }
     else if (endpoint === '/client/counselors') body=[];
     else if (endpoint === '/users/me/consents') body=Object.fromEntries(['tos','privacy','sensitive','eeg','research'].map(key=>[key,{agreed:!['eeg','research'].includes(key),version:'2.0',agreed_at:null,withdrawn_at:null}]));
     else if (endpoint.includes('/session-note-prompt') || endpoint.includes('/auto-approve')) body={enabled:true};
     else if (endpoint === '/chat/rooms') body={rooms:[],total:0};
     else if (endpoint === '/notifications/unread-count') body={unread:0};
     else if (endpoint === '/notifications') body={notifications:[],total:0,unread:0};
     else if (endpoint === '/reports') body={reports:[],total:0};
     else if (endpoint.includes('/public-key')) body={public_key:null};
     else if (endpoint.includes('/normalization')) body={models:[],baselines:[],active_model:null,model:null};
     return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
    }
    if(url.origin === origin && !url.pathname.startsWith('/socket.io')) return route.continue();
    results.externalRequests.push(url.origin+url.pathname); return route.abort();
   });
   const page=await context.newPage(); page.on('pageerror',error=>results.pageErrors.push({role,width,message:error.message}));
   const settings=role==='client'?'/app/profile':'/settings';
   await page.goto(origin+settings);
   await page.getByText('LINK BAND PLAYGROUND',{exact:true}).waitFor();
   await page.evaluate(()=>document.fonts.ready);
   const summaries = page.locator('[data-settings-group] > summary');
   assert.equal(await summaries.count(),5);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   assert.equal(overflow,false);
   if(width===390) { const tabs=page.getByRole('navigation',{name:'하단 메뉴'}); assert.equal(await tabs.getByRole('link').count(),5); assert.equal(await tabs.getByRole('link',{name:'설정',exact:true}).getAttribute('aria-current'),'page'); }
   const heroTitleColor=await page.getByRole('heading',{name:'내 마음의 신호를 만나보세요'}).evaluate(el=>getComputedStyle(el).color);
   assert.equal(heroTitleColor,'rgb(255, 255, 255)');
   await page.screenshot({path:path.join(out,`${role}-settings-${width}.png`),fullPage:true});
   const writesBefore=results.writes.filter(x=>x.endpoint==='/notifications/preferences').length;
   await summaries.filter({hasText:'알림'}).click();
   const notifications=page.getByRole('region',{name:'목적별 알림 설정'});
   await notifications.getByRole('switch').first().waitFor();
   assert.equal(await notifications.getByRole('switch').count(),6);
   assert.equal(results.writes.filter(x=>x.endpoint==='/notifications/preferences').length,writesBefore);
   const dimensions=await notifications.getByRole('switch').first().evaluate(el=>{const b=el.getBoundingClientRect(); return {width:b.width,height:b.height,track:el.querySelector('[data-switch-track]')?.getBoundingClientRect().toJSON()};});
   assert.equal(dimensions.track.width,52); assert.equal(dimensions.track.height,32); assert(dimensions.height>=44);
   await page.setViewportSize({width,height:1800});
   await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   await settleSwitches(page);
   await page.screenshot({path:path.join(out,`${role}-notifications-${width}.png`),fullPage:false});
   await page.setViewportSize({width,height:1000});
   await summaries.filter({hasText:'알림'}).click();
   await page.getByRole('link',{name:/플레이グラウンド|플레이그라운드 열기/}).first().click();
   await page.waitForURL('**/playground');
   const back=page.getByRole('link',{name:'← 설정으로 돌아가기'});
   await back.waitFor(); assert.equal(await back.getAttribute('href'),settings);
   await page.screenshot({path:path.join(out,`${role}-playground-${width}.png`),fullPage:true});
   await back.click(); await page.waitForURL('**'+settings);
   results.checks.push({role,width,groups:5,notificationSwitches:6,overflow,dimensions,playgroundRoundTrip:true,noInitialPreferenceWrite:true});
   await summaries.filter({hasText:'내 계정'}).click();
   if(role==='client') {
    await page.getByRole('link',{name:'참여 프로필 관리 ↗'}).click(); await page.waitForURL('**/app/participation-profile');
    await page.getByRole('link',{name:'← 설정으로 돌아가기'}).waitFor();
    await page.getByRole('link',{name:'← 설정으로 돌아가기'}).click();
    await page.goto(origin+'/settings'); await page.waitForURL('**/app/profile');
   } else if(role==='counselor') {
    await page.getByRole('link',{name:'상담사 프로필 관리 ↗'}).click(); await page.waitForURL('**/profile/professional');
    await page.getByRole('link',{name:'← 설정으로 돌아가기'}).waitFor();
    await page.getByRole('link',{name:'← 설정으로 돌아가기'}).click();
    await page.getByRole('link',{name:'리포트 · 운영 설정 ↗'}).click();
    await page.waitForURL('**/reports?settings=operations');
    await page.getByRole('switch',{name:'진행 기록 안내 받기'}).waitFor();
    assert.equal(await page.getByRole('switch',{name:'진행 기록 안내 받기'}).getAttribute('aria-checked'),'true');
    await settleSwitches(page);
    await page.screenshot({path:path.join(out,`${role}-operations-${width}.png`),fullPage:true});
   } else if(role==='org_admin') {
    assert.equal(await page.getByRole('link',{name:'상담사 프로필 관리 ↗'}).count(),0);
    await page.getByRole('link',{name:'리포트 · 운영 설정 ↗'}).click(); await page.waitForURL('**/reports?settings=operations');
    await page.getByRole('switch',{name:'진행 기록 안내 받기'}).waitFor();
   }
   await context.close();
  }
  assert.equal(results.pageErrors.length,0,JSON.stringify(results.pageErrors));
 } finally { fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(results,null,2)); await browser.close(); }
 console.log(JSON.stringify({checks:results.checks.length,pageErrors:results.pageErrors.length,captures:fs.readdirSync(out).filter(x=>x.endsWith('.png')).length}));
})().catch(e=>{console.error(e);process.exitCode=1});
