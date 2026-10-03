// SDD-105 실제 앱 라우트 렌더: REST/WS 응답만 격리하며 외부 서버 호출을 차단한다.
// 실행 방법은 specs/105-waiting-room-checkin/summary.md 참조.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const dir = process.env.WAITING_ROOM_SCREENSHOTS || require('node:path').resolve(__dirname, '../../specs/105-waiting-room-checkin/evidence');
fs.mkdirSync(dir, { recursive: true });
const baseUrl = process.env.WAITING_ROOM_TEST_URL || 'http://127.0.0.1:5176';
const session = {id:'sdd105',title:'나를 돌보는 저녁 명상',type:'meditation',status:'open',host_id:'host105',access_code:'ABC123',duration_min:50,max_participants:6,participant_count:6,participants:[],location_type:'online',participant_mode:'group',linkband_mode:'optional',scheduled_at:null,started_at:null,ended_at:null,opened_at:new Date().toISOString(),created_at:new Date().toISOString(),sfu_enabled:false,record_audio:false,record_video:false,waitlist_count:0};
const people = ['김민서','이서연','박지호','최유진','정하늘','윤도현'].map((nickname,i)=>({session_id:'sdd105',participant_id:`p${i}`,nickname,action:'join',readiness:{surveyDone:i>0,bandDone:i>0&&i!==4,deviceDone:i>0&&i!==5},checkin:null}));
(async()=>{
 const browser=await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(); let liveSocket; const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.startsWith('/api/')) {
   let body={}; let status=200;
   if(url.pathname.endsWith('/auth/refresh')) body={access_token:'test-only-token'};
   else if(url.pathname.includes('/by-code/ABC123/join')) body={participant_id:'p0',participant_token:'test-only-participant',session};
   else if(url.pathname.includes('/by-code/ABC123/state')) body={status:'open',guest_state:'waiting'};
   else if(url.pathname.includes('/by-code/ABC123')) body=session;
   else if(url.pathname.endsWith('/sessions/sdd105')) body=session;
   else if(url.pathname.includes('live-metrics')) body={metrics:[]};
   else if(url.pathname.includes('/checkin')) body={id:'checkin105',phase:'before',arousal:3,valence:3,note:null};
   else if(url.pathname.includes('bgm')||url.pathname.includes('audio')||url.pathname.includes('music')) body={tracks:[],items:[]};
   else {status=404;body={detail:'로컬 렌더 검증에서 제공하지 않는 API'};}
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  }
  if(url.hostname!=='127.0.0.1') return route.abort();
  return route.continue();
 });
 await page.routeWebSocket(/socket.io/,ws=>{
  ws.send('0'+JSON.stringify({sid:'render105',upgrades:[],pingInterval:25000,pingTimeout:20000,maxPayload:1000000}));
  ws.onMessage(data=>{
   const value=data.toString();
   if(value.startsWith('40/session-live,')) {
    liveSocket=ws; ws.send('40/session-live,'+JSON.stringify({sid:'render105'}));
    setTimeout(()=>people.forEach(person=>ws.send('42/session-live,'+JSON.stringify(['waiting_room_changed',person]))),1500);
   }
   if(value==='2')ws.send('3');
   const ack = value.match(/^42\/session-live,(\d+)(\[.*)$/);
   if(ack && JSON.parse(ack[2])[0] === 'waiting_room_remind') ws.send('43/session-live,'+ack[1]+JSON.stringify([{ok:true,sent:3}]));
  });
 });
 await page.goto(baseUrl+'/join?code=ABC123');
 await page.getByLabel('이름', {exact:false}).first().fill('김민서');
 await page.getByRole('button',{name:'클래스 참여하기'}).click();
 await page.getByRole('heading',{name:'잠시 후 시작합니다'}).waitFor();
 await page.screenshot({path:dir+'/member-survey-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'건너뛰기',exact:true}).first().click();
 await page.getByRole('tab',{name:/링크밴드/}).waitFor();
 await page.screenshot({path:dir+'/member-band-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'밴드 없이 진행하기'}).click();
 await page.screenshot({path:dir+'/member-devices-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'기기 테스트 건너뛰기',exact:true}).last().click();
 liveSocket.send('42/session-live,'+JSON.stringify(['waiting_room_reminder',{session_id:'sdd105',message:'상담사가 준비 상태 확인을 부탁했어요. 건너뛰어도 괜찮아요.'}]));
 await page.getByRole('status').filter({hasText:'상담사가 준비 상태 확인'}).waitFor();
 await page.screenshot({path:dir+'/member-ready-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:dir+'/member-ready-mobile.png',fullPage:true});
 const memberOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 await page.getByRole('tab',{name:/설문/}).click();
 await page.screenshot({path:dir+'/member-survey-mobile.png',fullPage:true});
 await page.evaluate(()=>localStorage.setItem('mb_user',JSON.stringify({id:'host105',name:'상담사',email:'host@example.test',role:'counselor',verified_tier:'fully_verified',onboarding_completed:true,auth_provider:'email',counselors:[]})));
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(baseUrl+'/sessions/sdd105/player');
 await page.getByRole('heading',{name:'준비 현황'}).waitFor();
 await page.getByText('미완 3명 리마인드',{exact:true}).waitFor();
 await page.getByRole('button',{name:'미완 3명 리마인드',exact:true}).click();
 await page.getByRole('status').filter({hasText:'서버가 3명'}).waitFor();
 await page.screenshot({path:dir+'/host-readiness-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:dir+'/host-readiness-mobile.png',fullPage:true});
 const hostOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 fs.writeFileSync(dir+'/render-results.json',JSON.stringify({fixture:'격리된 REST/WS 테스트 응답을 사용한 실제 앱 라우트 렌더',memberOverflow,hostOverflow,errors},null,2));
 await browser.close();
 assert.equal(memberOverflow, false, '회원 모바일 가로 넘침');
 assert.equal(hostOverflow, false, '상담사 모바일 가로 넘침');
 assert.deepEqual(errors, [], '브라우저 실행 오류');
})().catch(e=>{console.error(e);process.exit(1)});
