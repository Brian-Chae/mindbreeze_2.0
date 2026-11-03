"""독립 정적 시안 측정: 실제 Chrome CDP viewport. 앱/서버/API 호출 없음."""
from pathlib import Path
import subprocess, urllib.request, time, json, base64, tempfile, itertools
import websocket
p=Path(__file__).resolve().parent
proc=subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless','--no-sandbox','--disable-gpu','--remote-allow-origins=*','--remote-debugging-port=19281','--user-data-dir='+tempfile.mkdtemp(prefix='sdd280-v2-'),'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
seq=0
try:
 for _ in range(100):
  try: tabs=json.load(urllib.request.urlopen('http://127.0.0.1:19281/json'));break
  except Exception: time.sleep(.05)
 ws=websocket.create_connection(next(t for t in tabs if t['type']=='page')['webSocketDebuggerUrl']);ws.settimeout(20)
 def call(method,params=None):
  global seq
  seq+=1;ws.send(json.dumps(dict(id=seq,method=method,params=params or {})))
  while True:
   r=json.loads(ws.recv())
   if r.get('id')==seq:
    if 'error' in r: raise RuntimeError(r['error'])
    return r.get('result',{})
 def ev(s):
  r=call('Runtime.evaluate',dict(expression=s,returnByValue=True))
  if 'exceptionDetails' in r: raise RuntimeError(r['exceptionDetails'])
  return r.get('result',{}).get('value')
 measure=r'''(()=>{const m=document.querySelector('main'), f=document.querySelector('footer');
 const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
 const intersect=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));
 const clip=e=>{let r=rect(e);for(let a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a);if(/auto|hidden|scroll|clip/.test(s.overflowY)){const q=rect(a);r={...r,y:Math.max(r.y,q.y),bottom:Math.min(r.bottom,q.bottom)}}}r={...r,x:Math.max(0,r.x),right:Math.min(innerWidth,r.right),y:Math.max(0,r.y),bottom:Math.min(innerHeight,r.bottom)};return r};
 const shown=e=>!e.closest('[hidden]')&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0;
 const nodes=[...document.querySelectorAll('.summary-card,.tabs,.search-box,.selection-wrap,.reason,.panel-title,.row,.empty,.email-entry')].filter(shown);
 const targets=[...document.querySelectorAll('button,input,textarea')].filter(shown).map(e=>({label:e.getAttribute('aria-label')||e.textContent||e.tagName,r:rect(e.type==='checkbox'?e.closest('.row'):e)}));
 const badTargets=targets.filter(t=>t.r.width<43.9||t.r.height<43.9);
 const samples=[];const max=m.scrollHeight-m.clientHeight;
 for(const offset of [...new Set([0,Math.min(200,max),max/2,max])]){m.scrollTop=offset;const pairs=[];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];if(a.contains(b)||b.contains(a))continue;const ar=clip(a),br=clip(b);if(ar.bottom>ar.y&&br.bottom>br.y&&intersect(ar,br)>.5)pairs.push({a:a.className,b:b.className,area:intersect(ar,br)});}samples.push({scrollTop:m.scrollTop,overlaps:pairs,footerOverlap:nodes.filter(e=>{const r=clip(e);return r.bottom>r.y&&intersect(r,rect(f))>.5}).map(e=>e.className)});}
 const last=document.querySelector('.row:last-child');let lastReachable=null,lastRect=null;if(last){last.scrollIntoView({block:'end'});lastRect=rect(last);lastReachable=lastRect.y>=rect(m).y-.5&&lastRect.bottom<=rect(f).y+.5;}
 const reason=document.querySelector('.reason');let reasonReachable=null;if(shown(reason)){reason.querySelector('textarea').scrollIntoView({block:'end'});const r=rect(reason.querySelector('textarea'));reasonReachable=r.y>=rect(m).y-.5&&r.bottom<=rect(f).y+.5;}
 const fr=rect(f);return {innerWidth,innerHeight,footerBottomGap:innerHeight-fr.bottom,footerVisible:fr.y>=0&&Math.abs(innerHeight-fr.bottom)<.5,mainFooterIntersection:intersect(rect(m),fr),horizontalOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth,m.scrollWidth-m.clientWidth),badTargets,samples,lastReachable,lastRect,reasonReachable,scrollHeight:m.scrollHeight,clientHeight:m.clientHeight};})()'''
 call('Emulation.setFocusEmulationEnabled',dict(enabled=True))
 results=[]
 viewports=[(1440,900),(1280,720),(1024,768),(390,844),(390,600),(1280,600)]
 for option in ['b2-1','b2-2']:
  for w,h in viewports:
   call('Emulation.setDeviceMetricsOverride',dict(width=w,height=h,deviceScaleFactor=1,mobile=False))
   call('Page.navigate',dict(url=(p/f'option-{option}.html').as_uri()))
   for _ in range(100):
    if ev("document.readyState==='complete'&&typeof setState==='function'"):break
    time.sleep(.02)
   for n,admin,selected,empty,email in itertools.product([0,4,20,60],[False,True],[0,3,12],[False,True],[False,True]):
    state=dict(n=n,admin=admin,selected=selected,empty=empty,email=email)
    ev('setState('+json.dumps(state)+');fitSticky()')
    r=ev(measure)
    failures=[]
    if [r['innerWidth'],r['innerHeight']]!=[w,h]:failures.append('viewport')
    if not r['footerVisible'] or r['mainFooterIntersection']>.5:failures.append('footer')
    if r['horizontalOverflow']>.5:failures.append('horizontal')
    if r['badTargets']:failures.append('targets')
    if any(s['overlaps'] or s['footerOverlap'] for s in r['samples']):failures.append('overlap')
    if r['lastReachable'] is False:failures.append('last-row')
    if r['reasonReachable'] is False:failures.append('reason')
    results.append(dict(option=option,viewport=[w,h],state=state,pass_=not failures,failures=failures,measurement=r))
   if w in [1440,1024,390] and (w,h)!=(390,600):
    ev('setState({n:20,admin:true,selected:3,empty:false,email:false})')
    shot=call('Page.captureScreenshot',dict(format='png',captureBeyondViewport=False));(p/'shots'/f'{option}-{w}-20-admin.png').write_bytes(base64.b64decode(shot['data']))
   print(option,w,h,'완료',flush=True)
 focus_results=[]
 for option in ['b2-1','b2-2']:
  for w,h in [(390,600),(1280,600)]:
   call('Emulation.setDeviceMetricsOverride',dict(width=w,height=h,deviceScaleFactor=1,mobile=False))
   call('Page.navigate',dict(url=(p/f'option-{option}.html').as_uri()))
   for _ in range(100):
    if ev("document.readyState==='complete'&&typeof fitSticky==='function'"):break
    time.sleep(.02)
   ev('setState({n:60,admin:true,selected:12,empty:false,email:false});fitSticky()')
   f=ev("""(()=>{const m=document.querySelector('main'),foot=document.querySelector('footer');const targets=[...document.querySelectorAll('button,input,textarea')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]'));const failures=[];for(const e of targets){e.focus();const r=e.getBoundingClientRect();const f=foot.getBoundingClientRect();if(e.closest('main')&&(r.top<m.getBoundingClientRect().top-.5||r.bottom>f.top+.5))failures.push({label:e.getAttribute('aria-label')||e.textContent,top:r.top,bottom:r.bottom});}const c=document.querySelector('.row input');c.focus();c.click();const retained=document.activeElement?.dataset.id===c.dataset.id;const reason=document.querySelector('.reason textarea');reason.focus();return {targetCount:targets.length,failures,checkboxFocusRetained:retained,reasonFocused:document.activeElement===reason,leftPosition:getComputedStyle(document.querySelector('.left')).position};})()""")
   focus_results.append(dict(option=option,viewport=[w,h],result=f,pass_=not f['failures'] and f['checkboxFocusRetained'] and f['reasonFocused']))
   shot=call('Page.captureScreenshot',dict(format='png',captureBeyondViewport=False));(p/'shots'/f'{option}-{w}x{h}-12-focus-reason.png').write_bytes(base64.b64decode(shot['data']))
 # 비교 페이지의 실제 controls change -> postMessage -> 4 iframe 상태 적용 검증
 call('Emulation.setDeviceMetricsOverride',dict(width=1440,height=900,deviceScaleFactor=1,mobile=False))
 call('Page.navigate',dict(url=(p/'index.html').as_uri()))
 for _ in range(100):
  if ev("document.readyState==='complete'&&document.querySelectorAll('iframe').length===4"):break
  time.sleep(.05)
 time.sleep(.2)
 ev("document.querySelector('#members').value=60;document.querySelector('#selected').value=12;document.querySelector('#admin').checked=true;document.querySelector('#members').dispatchEvent(new Event('change'))")
 time.sleep(.1)
 frame_results=[]
 for frame in call('Page.getFrameTree')['frameTree'].get('childFrames',[]):
  fid=frame['frame']['id'];ctx=call('Page.createIsolatedWorld',dict(frameId=fid,worldName='independent-check'))['executionContextId']
  expression="""(()=>{const $=s=>document.querySelector(s);const layout=$('.layout'),m=$('main');const names=['.summary-card','.tabs','.search-box','.selection-wrap','.panel-title','.list','.reason'];const order=names.map(s=>({selector:s,top:$(s).getBoundingClientRect().top}));return {width:innerWidth,rows:document.querySelectorAll('.row').length,checked:document.querySelectorAll('.row input:checked').length,reasonVisible:!$('.reason').hidden,mobileOrder:order,footerBottom:document.querySelector('footer').getBoundingClientRect().bottom,height:innerHeight};})()"""
  rr=call('Runtime.evaluate',dict(expression=expression,contextId=ctx,returnByValue=True))['result']['value']
  rr['pass_']=rr['rows']==60 and rr['checked']==12 and rr['reasonVisible'] and abs(rr['footerBottom']-rr['height'])<.5 and (rr['width']>=1024 or all(rr['mobileOrder'][i]['top']<=rr['mobileOrder'][i+1]['top'] for i in range(len(rr['mobileOrder'])-1)))
  frame_results.append(rr)
 summary=dict(total=len(results),passed=sum(r['pass_'] for r in results),failed=sum(not r['pass_'] for r in results),method='Chrome headless CDP Emulation, file URL; 4 scroll positions; clipped bounding rectangles; checkbox target uses whole native label',focusChecks=focus_results,comparisonFrames=frame_results,results=results)
 (p/'validation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
 failures=[r for r in results if not r['pass_']]
 print(json.dumps(dict(total=summary['total'],passed=summary['passed'],failed=summary['failed'],firstFailures=failures[:3],focusChecks=focus_results,comparisonFrames=frame_results),ensure_ascii=False))
 if failures or any(not r['pass_'] for r in focus_results+frame_results):raise SystemExit(1)
finally:
 proc.terminate()
