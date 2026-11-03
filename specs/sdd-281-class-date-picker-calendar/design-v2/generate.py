from pathlib import Path
import json
p=Path(__file__).parent
s=(p.parent/'design/option-d1.html').read_text()
css='''
.handle{display:none}.date[aria-current=date]{border:2px solid #D2AEFC;background:rgba(210,174,252,.12)}.date[aria-current=date][aria-selected=true]{background:#5F0080;border:2px solid #D2AEFC}.date:disabled{background:rgba(255,255,255,.025);border-color:rgba(255,255,255,.04)}.sheetfoot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#CFC6D6}.sheetfoot button{padding:0 12px;background:transparent}.sheethead{height:44px}.sheethead b{font-size:18px}.handle{touch-action:none}.dates{touch-action:pan-y}.popup.calendar{overflow:visible}.legend{display:none}
@keyframes rise{from{transform:translateY(100%)}to{transform:translateY(0)}}
@media(max-width:767px){.popup.calendar{padding:8px 16px max(12px,env(safe-area-inset-bottom,0px));gap:6px;max-height:85dvh;background:rgba(24,12,36,.97);border:1px solid rgba(255,255,255,.14);border-radius:24px 24px 0 0;animation:rise .18s ease-out}.handle{display:block;width:100%;height:16px;min-height:16px;border:0;background:none;border-radius:0;padding:0;position:relative}.handle:after{content:'';position:absolute;left:calc(50% - 20px);top:4px;width:40px;height:4px;border-radius:4px;background:#CFC6D677}.sheethead button{width:44px;min-width:44px;border-radius:50%;background:#ffffff19}.backdrop{background:rgba(12,6,20,.55)}.week span{line-height:24px}.sheetfoot{height:44px;flex:none}.sheetfoot button{height:44px}.date{height:44px}.popup.calendar .dates{flex:none}body.modal{overflow:hidden}body.modal>header,body.modal>.steps,body.modal>main,body.modal>footer{pointer-events:none}.sheethead{flex:none}}
'''
s=s.replace('</style><body',css+'</style><body',1)
s=s.replace('<div class="sheethead"><b>시작 날짜</b><button id="close">닫기</button></div>','<button class="handle" aria-label="아래로 끌어 닫기"></button><div class="sheethead"><b id="sheet-title">시작 날짜 선택</b><button id="close" aria-label="닫기">×</button></div>')
s=s.replace('aria-label="시작 날짜 선택" aria-modal','aria-label="시작 날짜 선택" aria-labelledby="sheet-title" aria-modal')
s=s.replace('<span class="legend">오늘</span>','<div class="sheetfoot"><span>날짜를 누르면 바로 적용돼요</span><button id="today">오늘로 이동</button></div>')
s=s.replace('let value=today','let value=today')
s=s.replace("aria-label=\"${s}${s===today?' 오늘':''}\"", "aria-label=\"${d.getUTCFullYear()}년 ${d.getUTCMonth()+1}월 ${n}일 ${'일월화수목금토'[d.getUTCDay()]}요일${s===today?', 오늘':''}${s===value?', 선택됨':''}${s<today?', 선택 불가':''}\"")
s=s.replace("pop.hidden=true;shade.hidden=true;", "pop.hidden=true;shade.hidden=true;document.body.classList.remove('modal');for(const e of document.querySelectorAll('body>header,body>.steps,body>main,body>footer'))e.inert=false;")
s=s.replace("pop.hidden=false;cursor=value;", "pop.hidden=false;if(innerWidth<768){document.body.classList.add('modal');for(const e of document.querySelectorAll('body>header,body>.steps,body>main,body>footer'))e.inert=true}cursor=value;")
s=s.replace("r.left,innerWidth-w-8", "r.right-w,innerWidth-w-8")
s=s.replace("pop.setAttribute('aria-modal'", "if(!history.state?.sheet)history.pushState({sheet:true},'');pop.setAttribute('aria-modal'")
s=s.replace("function close(returnFocus=true){", "function close(returnFocus=true){")
# 시안 히스토리: 열린 상태에서 뒤로가기는 닫기만 수행. 다른 닫기는 현재 항목을 교체한다.
s=s.replace("trigger.setAttribute('aria-expanded','false');if(returnFocus)","if(history.state?.sheet)history.replaceState({},'');trigger.setAttribute('aria-expanded','false');if(returnFocus)")
s=s.replace("if(new URLSearchParams(location.search).has('open')", "if(new URLSearchParams(location.search).has('open')")
s=s.replace('</script>', '''
window.addEventListener('popstate',()=>{if(!pop.hidden)close()});
$('#today').onclick=()=>{month=parse('2026-11-01');cursor=today;render(true)};
let gesture=null,suppressClick=false;pop.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false}},true);pop.addEventListener('pointerdown',e=>{if(e.target.closest('.handle,.dates')){gesture={x:e.clientX,y:e.clientY,handle:!!e.target.closest('.handle')};if(gesture.handle)e.target.setPointerCapture(e.pointerId)}});
pop.addEventListener('pointerup',e=>{if(!gesture)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(gesture.handle&&dy>50)close();else if(!gesture.handle&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)){suppressClick=true;setTimeout(()=>suppressClick=false,100);changeMonth(dx<0?1:-1);e.preventDefault()}gesture=null});
window.previewMonth=(m)=>{month=parse(m+'-01');cursor=m+'-01';if(cursor<today)cursor=today;render(!pop.hidden)};
const params=new URLSearchParams(location.search);if(params.has('selected')){value=params.get('selected');document.body.dataset.date=value;trigger.textContent=label(value)+' ﹀';cursor=value;render(!pop.hidden)}if(params.has('month'))previewMonth(params.get('month'));
</script>''')
for name in ['option-d1-mobile-sheet.html','option-d1-desktop.html']: (p/name).write_text(s)
frames=[('닫힘',390,844,''),('시트 열림 · 오늘 링 + 선택 채움',390,844,'?open'),('다른 달 · 12월',390,844,'?open&month=2026-12'),('선택 후 닫힘',390,844,'?selected=2026-11-24'),('지난 날짜 비활성 · 오늘/선택 분리',390,844,'?open&selected=2026-11-24'),('6주 달 · 2027년 5월',390,844,'?open&month=2027-05'),('낮은 화면 · 6주 달',390,600,'?open&month=2027-05'),('소형 화면 · 6주 달',360,740,'?open&month=2027-05'),('데스크톱 · 우측 정렬',1440,900,'?open')]
# srcdoc으로 모든 프레임에 HTML 내장: index 자체도 외부 의존 없음
from html import escape
items=''
for title,w,h,q in frames:
    embedded=s.replace("const params=new URLSearchParams(location.search)",f"const params=new URLSearchParams({json.dumps(q)})")
    # 자동 열림도 쿼리 대신 프레임 상태 사용
    embedded=embedded.replace("new URLSearchParams(location.search).has('open')",f"new URLSearchParams({json.dumps(q)}).has('open')")
    items+=f'<article><h2>{title}</h2><p>{w} × {h} · 프레임 안에서 날짜 선택·스와이프·닫기 가능</p><iframe title="{title}" width="{w}" height="{h}" srcdoc="{escape(embedded,quote=True)}"></iframe></article>'
(p/'index.html').write_text('''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SDD-281 D-1 시안 v2</title><style>body{margin:0;padding:32px;background:#100a18;color:#f7f4f0;font:15px system-ui}h1{font-size:28px}p{color:#cfc6d6;line-height:1.6}main{display:flex;flex-wrap:wrap;gap:28px;align-items:start}h2{font-size:18px}iframe{border:1px solid #756183;border-radius:16px;background:#180c24;max-width:none}article{max-width:none}a{color:#d2aefc}.comparison{display:flex;gap:24px;flex-wrap:wrap}select,button{font:inherit;padding:10px;background:#24132f;color:white;border:1px solid #b373ef;border-radius:12px}</style><h1>D-1 확정 · 모바일 Bottom Sheet</h1><p>오늘 2026년 11월 3일 고정. 모바일 768px 미만은 하단 시트, 데스크톱은 326px 팝오버.<br>오늘은 셀 테두리 + 점, 선택일은 보라 채움. 날짜 탭 즉시 적용. 배경·닫기·ESC·핸들 드래그·뒤로가기로 취소.<br>시트가 이전/다음 바를 덮고 배경 폼을 잠급니다. 2026년 11월·8월은 5주이므로 실제 6주인 2027년 5월을 추가했습니다.</p><div class="comparison"><p><b>채택안 · 즉시 선택</b><br>열기 + 날짜 = 2탭. 다시 열어 수정. 모바일 시·분 select의 즉시 반영과 일관.</p><p><b>비교안 · 확인 버튼</b><br>열기 + 날짜 + 확인 = 3탭. 오탭 취소에 유리하나 단일 날짜 선택에는 단계 추가.</p></div><p><a href="option-d1-mobile-sheet.html">모바일 단독 시안</a> · <a href="option-d1-desktop.html?open">데스크톱 단독 시안</a></p><main>'''+items+'</main></html>')
