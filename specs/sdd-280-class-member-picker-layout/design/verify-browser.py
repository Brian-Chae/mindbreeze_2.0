"""정적 시안만 로컬 Chrome CDP로 검증. 앱·네트워크 API 미사용."""
from pathlib import Path
import subprocess, urllib.request, time, json, base64, tempfile
import websocket
p=Path(__file__).resolve().parent
proc=subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless','--no-sandbox','--disable-gpu','--remote-allow-origins=*','--remote-debugging-port=19280','--user-data-dir='+tempfile.mkdtemp(prefix='sdd280-'),'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(50):
  try: tabs=json.load(urllib.request.urlopen('http://127.0.0.1:19280/json'));break
  except Exception: time.sleep(.1)
 ws=websocket.create_connection(next(t for t in tabs if t['type']=='page')['webSocketDebuggerUrl']); seq=0
 def call(method,params={}):
  global seq
  seq+=1;ws.send(json.dumps(dict(id=seq,method=method,params=params)))
  while True:
   r=json.loads(ws.recv())
   if r.get('id')==seq:return r.get('result',{})
 def evaluate(s):return call('Runtime.evaluate',dict(expression=s,returnByValue=True)).get('result',{}).get('value')
 results=[]
 for key in ['before','a','b','c']:
  for w,h in [(1440,1000),(390,844)]:
   call('Emulation.setDeviceMetricsOverride',dict(width=w,height=h,deviceScaleFactor=1,mobile=False))
   for admin in [True,False]:
    call('Page.navigate',dict(url=(p/('before.html' if key=='before' else f'option-{key}.html')).as_uri()))
    for _ in range(50):
     if evaluate("document.readyState==='complete'&&!!document.querySelector('.row')"):break
     time.sleep(.05)
    evaluate("search.value='가상';draw();document.querySelector('.reason').hidden="+str(not admin).lower())
    result=evaluate("""(()=>{const l=list,m=document.querySelector('main'),reason=document.querySelector('.reason'),f=document.querySelector('footer');const rect=e=>e.getBoundingClientRect();l.scrollTop=100;m.scrollTop=100;const result={width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth,listScroll:l.scrollTop,bodyScroll:m.scrollTop,overlap:!reason.hidden&&rect(l).bottom>rect(reason).top,listPastCard:rect(l).bottom>rect(document.querySelector('.card')).bottom,listPastFooter:rect(l).bottom>rect(f).top,visibleListPastFooter:Math.min(rect(l).bottom,getComputedStyle(m).overflowY==='auto'?rect(m).bottom:Infinity)>rect(f).top};m.scrollTop=0;l.scrollTop=0;document.querySelector('.row input').click();result.selected=picked.size;search.value='20';draw();result.filtered=list.children.length;search.value='가상';draw();return result})()""")
    results.append(dict(option=key,viewport=[w,h],admin=admin,result=result))
    if admin:
     shot=call('Page.captureScreenshot',dict(format='png',captureBeyondViewport=True))
     (p/'shots'/f'{key}-{w}.png').write_bytes(base64.b64decode(shot['data']))
 (p/'validation.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps(results,ensure_ascii=False))
finally:proc.terminate()
