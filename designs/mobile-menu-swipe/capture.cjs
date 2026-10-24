// 독립 HTML 체험만 확인한다. 제품 앱·기기 검증 결과가 아니다.
const { chromium, webkit } = require('/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true,isMobile:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const checks=[];
 const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
 const route=()=>page.locator('#route').textContent();
 const ready=async()=>{await page.waitForTimeout(320);};
 async function mouseDrag(dx,dy=0,x=270,y=300) {
  await page.mouse.move(x,y);await page.mouse.down();
  for(let n=1;n<=8;n++){await page.mouse.move(x+dx*n/8,y+dy*n/8);await page.waitForTimeout(25);}
  await page.mouse.up();await ready();
 }
 const cdp=await page.context().newCDPSession(page);
 async function touchDrag(dx,dy=0,x=270,y=300) {
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});
  for(let n=1;n<=8;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*n/8,y:y+dy*n/8,id:0}]});await page.waitForTimeout(25);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await ready();
 }
 try {
  await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);await page.evaluate(()=>document.fonts.ready);
  check('초기 회원 홈',await route(),'/app');
  // 패드 밖 본문에서 실제 터치가 취소되지 않고 두 페이지가 1:1로 따라오는지 확인한다.
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:270,y:200,id:0}]});
  for(let n=1;n<=5;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:270-24*n,y:200,id:0}]});await page.waitForTimeout(25);}
  const middle=await page.evaluate(()=>({x:document.querySelector('#screen').getBoundingClientRect().x,neighbor:document.querySelector('.neighbor .screen-head h2')?.textContent}));
  check('패드 밖 터치 120px에 화면 1:1 추종',Math.round(middle.x),-120);
  check('드래그 중 이웃 메뉴 표시',middle.neighbor,'내 클래스');
  await page.screenshot({path:path.join(__dirname,'captures/04-mid-drag-pages-390.png')});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await ready();
  check('중간 프레임 취소 후 홈 복귀',await route(),'/app');

  await page.screenshot({path:path.join(__dirname,'captures/01-member-home-390.png')});
  await touchDrag(-105,0,270,200);check('터치: 패드 밖 홈 → 내 클래스',await route(),'/app/classes');
  check('터치 전환 후 하단 강조 변경',await page.locator('#nav [aria-current=page] span').textContent(),'내 클래스');
  await page.screenshot({path:path.join(__dirname,'captures/02-touch-next-tab-390.png')});
  await touchDrag(105,0,110,200);check('터치: 패드 밖 내 클래스 → 홈',await route(),'/app');
  await touchDrag(-30,0,270,200);check('터치: 짧게 밀면 홈 복귀',await route(),'/app');
  check('짧은 터치 후 화면 원위치',await page.locator('#screen').evaluate(el=>Math.round(el.getBoundingClientRect().x)),0);
  await mouseDrag(-105);await mouseDrag(105,0,110);check('마우스: 내 클래스 → 홈',await route(),'/app');
  await mouseDrag(100,0,110);check('첫 메뉴에서 순환 없음',await route(),'/app');
  await mouseDrag(-30);check('느린 짧은 드래그 취소',await route(),'/app');
  await mouseDrag(-40,70);check('세로 우세 취소',await route(),'/app');
  await mouseDrag(100,0,12);check('왼쪽 가장자리 제외',await route(),'/app');
  await mouseDrag(-100,0,378);check('오른쪽 가장자리 제외',await route(),'/app');
  await mouseDrag(-100,0,260,510);check('가로 레일 출발 제외',await route(),'/app');
  await page.evaluate(()=>getSelection().removeAllRanges());
  for(const guard of ['class','input','sheet','dirty','detail']) {
   await page.locator(`#guard-${guard}`).check();await mouseDrag(-110);check(`${guard} 상태 스와이프 차단`,await route(),'/app');
   if(guard==='class'){await touchDrag(-110,0,270,200);check('실제 터치: 수업 중 이동 차단',await route(),'/app');}
   if(guard==='class')await page.screenshot({path:path.join(__dirname,'captures/03-protected-class-390.png')});
   await page.locator(`#guard-${guard}`).uncheck();
  }
  await page.locator('#guard-dirty').check();await page.locator('#nav button').nth(1).click();
  check('미저장 상태 버튼 이동 확인창',await page.locator('#dialog').evaluate(el=>el.open),true);
  await page.locator('#dialog-cancel').click();check('확인창 취소 후 유지',await route(),'/app');
  await page.locator('#nav button').nth(1).click();await page.locator('#dialog-ok').click();await ready();
  check('보호 확인 후 목적 메뉴 도착',await route(),'/app/classes');
  check('보호 확인 후 상황 해제',await page.locator('#guard-dirty').isChecked(),false);
  await page.locator('#guard-dirty').uncheck();
  await page.locator('#nav button').nth(3).click();await ready();check('버튼 대체 이동',await route(),'/app/reports');
  await mouseDrag(-110);check('마지막 메뉴에서 더보기 자동 열림 없음',await page.locator('#dialog').evaluate(el=>el.open),false);check('마지막 메뉴 순환 없음',await route(),'/app/reports');
  await page.locator('#nav button').nth(4).click();check('더보기 버튼으로만 열림',await page.locator('#dialog').evaluate(el=>el.open),true);await page.locator('#dialog-ok').click();
  await page.locator('#role').selectOption('counselor');
  check('상담사 비공개 탭 순서',await page.locator('#nav button span').allTextContents(),['홈','클래스','리포트','대화','더보기']);
  await page.locator('#counseling').check();check('상담사 공개 탭 순서',await page.locator('#nav button span').allTextContents(),['홈','클래스','상담','대화','더보기']);
  await page.locator('#role').selectOption('org_admin');check('기관관리자 홈 라우트',await route(),'/dashboard/org');
  check('기관관리자 공개 탭 순서',await page.locator('#nav button span').allTextContents(),['홈','클래스','상담','대화','더보기']);
  await page.locator('#counseling').uncheck();check('기관관리자 비공개 탭 순서',await page.locator('#nav button span').allTextContents(),['홈','클래스','리포트','대화','더보기']);
  await page.locator('#role').selectOption('client');await page.locator('#counseling').check();check('회원 공개 탭 순서',await page.locator('#nav button span').allTextContents(),['홈','내 클래스','상담','리포트','더보기']);
  await page.locator('#counseling').uncheck();check('회원 비공개 탭 순서',await page.locator('#nav button span').allTextContents(),['홈','내 클래스','대화','리포트','더보기']);
  await page.emulateMedia({reducedMotion:'reduce'});await mouseDrag(-110);check('움직임 줄이기에서도 메뉴 이동',await route(),'/app/classes');
  check('움직임 줄이기에서 잔여 transform 없음',await page.locator('#screen').evaluate(el=>getComputedStyle(el).transform),'none');
  await page.locator('#nav button').nth(0).click();await ready();
  // 터치 취소, 세로 스크롤, 가로 레일은 브라우저 입력 경로로 확인한다.
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:270,y:300,id:0}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:170,y:300,id:0}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await ready();
  check('터치 취소 시 이동 없음',await route(),'/app');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const scrollBefore=await page.evaluate(()=>scrollY);
  await touchDrag(-5,-85);check('실제 터치 세로 우세 시 이동 없음',await route(),'/app');
  check('실제 터치 세로 스크롤 유지',await page.evaluate(()=>scrollY)>scrollBefore,true);
  await page.evaluate(()=>window.scrollTo(0,0));
  const railBefore=await page.locator('#rail').evaluate(el=>el.scrollLeft);
  await touchDrag(-100,0,270,510);check('터치 레일 출발은 탭 이동 없음',await route(),'/app');
  check('가로 레일은 자체 스크롤됨',await page.locator('#rail').evaluate(el=>el.scrollLeft)>railBefore,true);
  await page.mouse.move(270,300);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.move(150,300,{steps:8});await page.mouse.up();await ready();
  check('길게 누른 뒤 드래그는 이동 없음',await route(),'/app');
  // 속도 판정은 실행 장비 지연 대신 CDP 입력 시각을 명시한다(45px / 55ms).
  const stamp=Date.now()/1000;
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:270,y:300,button:'left',buttons:1,clickCount:1,timestamp:stamp});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:255,y:300,button:'left',buttons:1,timestamp:stamp+.020});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:225,y:300,button:'left',buttons:1,timestamp:stamp+.050});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:225,y:300,button:'left',buttons:0,clickCount:1,timestamp:stamp+.055});
  await ready();check('CDP 시각 지정 45px/55ms 빠른 이동',await route(),'/app/classes');
  await page.locator('#guard-input').check();await page.locator('#draft').fill('저장되지 않은 체험 입력');
  await page.locator('#guard-input').uncheck();await page.evaluate(()=>window.scrollTo(0,0));
  await mouseDrag(-110);check('입력 포커스 해제 후에도 미전송 내용 보호',await route(),'/app/classes');
  check('입력 내용 보존',await page.locator('#draft').inputValue(),'저장되지 않은 체험 입력');
  await page.locator('#guard-input').check();await page.locator('#draft').fill('');await page.locator('#guard-input').uncheck();await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.selection'));getSelection().removeAllRanges();getSelection().addRange(range);});
  await touchDrag(-110);check('선택된 일반 본문이 있을 때 이동 없음',await route(),'/app/classes');
  check('일반 본문은 선택 가능',await page.locator('.selection').evaluate(el=>getComputedStyle(el).userSelect),'text');
  await page.evaluate(()=>getSelection().removeAllRanges());
  const metrics=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,nav:[...document.querySelectorAll('#nav button')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,fontSize:getComputedStyle(el).fontSize})),smallText:[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(el).fontSize)<=12).map(el=>el.tagName)}));
  check('390px 가로 넘침 없음',metrics.scrollWidth,390);check('12px 이하 표시 텍스트 없음',metrics.smallText,[]);check('하단 메뉴 터치 영역 44px 이상',metrics.nav.every(b=>b.width>=44&&b.height>=44),true);check('브라우저 실행 오류 없음',errors,[]);
  fs.writeFileSync(path.join(__dirname,'capture-results.json'),JSON.stringify({scope:'A안 확정 · 독립 HTML 프로토타입. 제품 앱/네이티브/실기기 검증 아님',webkit:{available:fs.existsSync(webkit.executablePath()),status:'실행 파일 미설치로 미실행'},baseline:{commit:'07fcd35c',pad:{fingerDx:-120,screenDx:-30},outsidePad:{x:270,y:200,events:['pointerdown','pointermove','pointercancel'],routeAfter:'/app',touchAction:'auto'}},chrome:browser.version(),viewport:{width:390,height:844},checks,metrics,errors},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,chrome:browser.version(),metrics},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
