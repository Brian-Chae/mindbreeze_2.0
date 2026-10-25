# 저장된 실제 브라우저 측정에서 파생 표만 생성한다. 제품 코드를 실행/수정하지 않는다.
import json, re, sys
from pathlib import Path
from collections import Counter
# 인자로 출력 디렉터리를 주면 그 디렉터리의 measurements를 요약한다(구현 후 재측정용).
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).parent
rows=[json.loads(p.read_text()) for p in sorted((root/'measurements').glob('*.json'))]
homes={d['role']+'-'+str(d['width']):d for d in rows if d['url']==d.get('home')}
def frame(d):
 w=d.get('wrappers',[])
 for pattern in [r'\bmh-home\b',r'\bch-home\b',r'\bmc-stack\b']:
  hit=next((x for x in w if re.search(pattern,x['class'])),None)
  if hit:return hit
 c=d.get('content')
 hit=next((x for x in w if x!=c and x['maxWidth']!='none'),None)
 if hit:return hit
 candidate=next((x for x in w if x!=c),c)
 if candidate and re.search(r'rounded|\bcard\b|border',candidate['class']):return c
 return candidate
def button(d,kind):
 xs=[x for x in d.get('controls',[]) if x['kind']==kind and x['height']<=64 and not x['disabled']]
 return next((x for x in xs if x['inContent']),xs[0] if xs else None)
def card(d):
 xs=[x for x in d.get('cards',[]) if float(re.match(r'[\d.]+',x['radius'])[0])>=8 and 'hero' not in x['class']]
 return next((x for x in xs if x['class']=='mc-card' or 'ch-panel' in x['class']),xs[0] if xs else None)
def num(v):
 if isinstance(v,(int,float)):return round(v,2)
 try:return round(float(re.match(r'^(-?[\d.]+)(?:px)?$',str(v))[1]),2)
 except:return None
def delta(a,b):
 a,b=num(a),num(b)
 return round(a-b,2) if a is not None and b is not None else None
def status(d):
 if d.get('failure') or d.get('errors') or 'Unexpected Application Error' in d.get('bodyText',''):return '측정/렌더 오류'
 if d['redirected']:return '리다이렉트'
 if d['pattern']=='*':return '의도된 404'
 if d['pattern'] in ['/report-view','/membership-invite']:return '토큰 미제공 안내'
 if '전용 페이지입니다' in d.get('bodyText',''):return '권한 안내'
 if len(d.get('bodyText','').strip())==0:return '빈 화면'
 if d.get('unknown'):return 'fixture 부분'
 if '/design' in d['url']:return '시안(비범위)'
 if '/player' in d['url']:return '플레이어(제외 제안)'
 return '렌더 표본'
def fmt(v):return '—' if v is None else str(v).replace('|','\\|').replace('\n',' ')
def pair(v,h):
 diff=delta(v,h)
 return f'{fmt(v)} ({diff:+g})' if diff is not None else f'{fmt(v)} (기준 {fmt(h)})'
def metric(d):
 f=frame(d);c=d.get('content');t=d.get('title')
 return {'frameX':f['x'] if f else None,'contentLeft':f['x']+f['paddingLeft'] if f else None,'maxWidth':f['maxWidth'] if f else None,'framePaddingLeft':f['paddingLeft'] if f else None,'shellPaddingLeft':c['paddingLeft'] if c else None,'titleFont':t['fontSize'] if t else None,'titleWeight':t['fontWeight'] if t else None,'titleY':t['y'] if t else None,'titleMarginTop':t['marginTop'] if t else None,'frameGap':f['gap'] if f else None}
head=['# 페이지×항목 실측 차이','', '괄호의 부호 있는 숫자는 **같은 역할·같은 폭 홈 대비 차이(px)**. font-weight는 단위 없는 수치다. 표의 frame 선택 selector는 `page-matrix.json`에 보존한다. padding 층이 다르면 contentLeft=x+paddingLeft를 함께 본다. 너비가 좁은 폼/문서/채팅·별도 온보딩·플레이어·시안의 큰 차이는 곧바로 수정할 결함이 아니다. 리다이렉트는 목적 화면의 측정이며 원래 경로의 독립 화면으로 세지 않는다.','', '| 경로 / 역할 / 폭 | 상태 | frame x | contentLeft | frame max-width | frame PL | shell PL | 제목 size | 제목 weight | 제목 y | 제목 marginTop | frame gap |', '|---|---|---:|---:|---|---:|---:|---:|---|---:|---:|---|']
control=['# 버튼·카드·입력·탭·칩 실측 차이','', '대표 요소 비교. 원본 JSON에는 모든 후보가 있으며 대표는 버튼형 카드(높이>64px)를 제외한 본문 우선 요소다. 요소가 없으면 N/A. 버튼 종류는 색·class·aria에 따른 수집용 분류이며 동일 기능이라는 판정은 별도 검토한다. `9999px` radius 차이는 CSS 수치 차이이며 실제 곡률 반경 차이가 아니다. hover는 JSON의 hover에 normal/hover를 나란히 저장한다.','', '| 경로 / 역할 / 폭 | 종류 | 요소 | 높이 | radius | PL | PT | font-size | font-weight | 색/배경 |', '|---|---|---|---:|---|---:|---:|---:|---|---|']
mat=[]
for d in rows:
 h=homes.get(d['role']+'-'+str(d['width']));m=metric(d);hm=metric(h) if h else {}
 label=f"`{d['url']}` {d['role']} {d['width']}"
 head.append('| '+label+' | '+status(d)+' | '+' | '.join(pair(m[k],hm.get(k)) if h else fmt(m[k]) for k in m)+' |')
 elems={k:button(d,k) for k in ['primary','secondary','ghost','icon']}
 elems.update(card=card(d),input=next(iter(d.get('inputs',[])),None),tab=next((x for x in d.get('controls',[]) if x['kind']=='tab'),None),chip=next((x for x in d.get('chips',[]) if x['tag']!='BUTTON'),None))
 hel={k:button(h,k) for k in ['primary','secondary','ghost','icon']} if h else {}
 if h:hel.update(card=card(h),input=next(iter(h.get('inputs',[])),None),tab=next((x for x in h.get('controls',[]) if x['kind']=='tab'),None),chip=next((x for x in h.get('chips',[]) if x['tag']!='BUTTON'),None))
 for kind,e in elems.items():
  he=hel.get(kind)
  if not e:control.append(f'| {label} | {kind} | N/A | — | — | — | — | — | — | — |');continue
  values=[pair(e[k],he[k]) if he else fmt(e[k]) for k in ['height','radius','paddingLeft','paddingTop','fontSize','fontWeight']]
  control.append('| '+label+' | '+kind+' | '+fmt(e['text'][:28])+' | '+' | '.join(values)+' | '+fmt(e['color']+' / '+e['background'])+' |')
 mat.append({'id':d['id'],'url':d['url'],'role':d['role'],'width':d['width'],'status':status(d),'frameSelector':frame(d)['selector'] if frame(d) else None,'metrics':m,'homeMetrics':hm,'delta':{k:delta(m[k],hm.get(k)) for k in m},'representatives':elems,'homeRepresentatives':hel})
(root/'page-matrix.md').write_text('\n'.join(head)+'\n')
(root/'component-matrix.md').write_text('\n'.join(control)+'\n')
(root/'page-matrix.json').write_text(json.dumps(mat,ensure_ascii=False,indent=2)+'\n')
coverage=['# 라우트 측정 커버리지','','| 경로 | 역할 | 폭 | 실제 경로 | 상태 | 오류 / 미등록 API | 캡처 |','|---|---|---:|---|---|---|---|']
for d in rows:coverage.append(f"| `{d['pattern']}` | {d['role']} | {d['width']} | `{d['actual']}` | {status(d)} | {fmt(d.get('failure') or '; '.join(d.get('errors',[])+d.get('unknown',[])) or '없음')} | [PNG](captures/{d['id']}.png) |")
(root/'coverage.md').write_text('\n'.join(coverage)+'\n')
summary={'count':len(rows),'statuses':dict(Counter(status(d) for d in rows)),'errors':[d['id'] for d in rows if status(d)=='측정/렌더 오류'],'unknown':sorted({p for d in rows for p in d.get('unknown',[])}),'blockedWrites':[{ 'id':d['id'],'requests':d['blockedWrites']} for d in rows if d.get('blockedWrites')],'revisions':dict(Counter(d.get('fixtureRevision',1) for d in rows))}
(root/'coverage-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False))
# 종류별 대표 요소의 전체 스타일 차이. 홈에 없는 탭/입력은 비교 기준 없음으로 별도 기록한다.
changes=[];missing=[]
fields=['height','radius','paddingLeft','paddingRight','paddingTop','paddingBottom','fontSize','fontWeight','fontFamily','lineHeight','color','background','border','shadow']
for entry in mat:
 d=next(x for x in rows if x['id']==entry['id']);h=homes.get(d['role']+'-'+str(d['width']))
 if not h or status(d) in ['측정/렌더 오류','리다이렉트']:continue
 for kind,e in entry['representatives'].items():
  he=entry['homeRepresentatives'].get(kind)
  if e is None or he is None:
   missing.append({'id':d['id'],'kind':kind,'reason':'페이지 요소 없음' if e is None else '역할 홈 기준 요소 없음'});continue
  for f in fields:
   if e.get(f)!=he.get(f):changes.append({'id':d['id'],'kind':kind,'field':f,'selector':e['selector'],'homeSelector':he['selector'],'actual':e.get(f),'home':he.get(f),'delta':delta(e.get(f),he.get(f))})
 for hv in d.get('hover',[]):
  hh=next((x for x in h.get('hover',[]) if x['kind']==hv['kind']),None)
  if not hv.get('hover') or not hh or not hh.get('hover'):continue
  for f in ['background','color','border','shadow','radius']:
   if hv['hover'][f]!=hh['hover'][f]:changes.append({'id':d['id'],'kind':hv['kind']+':hover','field':f,'selector':hv['selector'],'homeSelector':hh['selector'],'actual':hv['hover'][f],'home':hh['hover'][f],'delta':delta(hv['hover'][f],hh['hover'][f])})
(root/'style-differences.json').write_text(json.dumps({'differences':changes,'notComparable':missing},ensure_ascii=False,indent=2)+'\n')
lines=['# 대표 요소 전체 스타일 차이','','같은 역할·폭 홈 기준. radius 숫자는 CSS 선언값 차이이며 유효 곡률과 다를 수 있다. 대상 기능이 다른 요소는 단순 차이 관측으로만 읽고 공용 variant를 정할 때 의미를 재분류한다. 홈에 없는 종류는 JSON notComparable에 기록하며 숫자를 추정하지 않는다.','', '| 표본 | 종류·속성 | 현재 | 홈 | 차이(px, weight는 단위없음) |','|---|---|---|---|---:|']
lines += [f"| `{x['id']}` | {x['kind']}.{x['field']} | {fmt(x['actual'])} | {fmt(x['home'])} | {fmt(x['delta'])} |" for x in changes]
(root/'style-differences.md').write_text('\n'.join(lines)+'\n')
# 섹션 간 실제 sibling 간격은 grid 열의 음수 간격까지 그대로 남겨 추정을 피한다.
(root/'section-gaps.json').write_text(json.dumps([{ 'id':d['id'],'home':d.get('home'),'sections':d.get('sections',[])} for d in rows],ensure_ascii=False,indent=2)+'\n')

section_rows=['# 섹션 간격과 홈 간격 기준 비교','','각 페이지 section/article 및 직접 child의 next sibling과의 실제 수직 거리. 기준은 같은 역할 홈의 주 frame gap이다. 같은 이름의 섹션끼리 대응한 결과가 아니며 페이지별 조립용 간격을 홈 스케일과 비교하는 후보 표다. 음수는 겹침/같은 행 가능성이 있어 차이를 계산하지 않는다. 홈이 space-y 방식이면 frame gap=normal이므로 수치 비교하지 않고 원본을 보존한다.','', '| 표본 | 섹션 selector | 실제 sibling gap | 홈 frame gap | 차이(px) |','|---|---|---:|---|---:|']
for d in rows:
 h=homes.get(d['role']+'-'+str(d['width']));hg=frame(h)['gap'] if h and frame(h) else None
 for x in d.get('sections',[]):
  v=x.get('nextVerticalGap')
  if v is None:continue
  dv=delta(v,hg) if v>=0 else None
  section_rows.append(f"| `{d['id']}` | `{x['selector']}` | {fmt(num(v))} | {fmt(hg)} | {fmt(dv)} |")
(root/'section-gap-matrix.md').write_text('\n'.join(section_rows)+'\n')
