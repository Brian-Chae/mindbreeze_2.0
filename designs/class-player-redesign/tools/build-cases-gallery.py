import os,re,html
M={"M01":"온라인 1:1 · 기본","M02":"온라인 그룹 · 기본 뮤트","M03":"손들기 대기","M04":"발언권 부여(말하는 중)","M05":"오프라인 대면","M06":"오프라인 · 밴드 없음","M07":"온라인 · 밴드 없음","M08":"밴드 연결 대기","M09":"밴드 신호 약함","M10":"밴드 접촉 불량","M11":"밴드 끊김(재연결)","M12":"밴드 배터리 부족","M13":"미지원 브라우저","M14":"마이크 꺼짐(AI 기록 제외)","M15":"마이크 권한 거부","M16":"내 카메라 꺼짐","M17":"카메라 권한 거부·기기 없음","M18":"네트워크 재연결 중","M19":"네트워크 끊김","M20":"대기열 입장 대기","M21":"수업 종료"}
C={"C01":"온라인 그룹 · 기준선","C02":"손든 회원 2명","C03":"발언권 부여 중","C04":"오프라인 대면 그룹","C05":"온라인 1:1","C06":"오프라인 1:1","C07":"카메라 꺼짐","C08":"카메라 권한 거부","C09":"마이크 꺼짐","C10":"마이크 권한 거부","C11":"녹음 중","C12":"접촉 확인 3 · 배터리 2","C13":"전원 밴드 미착용","C14":"대기열 3명","C15":"내 밴드 상태","C16":"네트워크 재연결 중","C17":"종료 확인 · 리포트 생성","C18":"20명 그리드"}
here=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files=sorted(os.listdir(os.path.join(here,'shots/cases')))
order=['390x844','834x1194','1194x834','1280x720']
def sec(prefix,labels,page,title):
    out=[f'<h2>{title}</h2><div class="g">']
    for k,v in labels.items():
        imgs=[f for f in files if f.startswith(f'{prefix}-{k}-') and f.endswith('.png')]
        imgs.sort(key=lambda f:order.index(re.search(r'(\d+x\d+)',f).group(1)) if re.search(r'(\d+x\d+)',f).group(1) in order else 9)
        if not imgs: continue
        out.append(f'<section><h3>{k} · {html.escape(v)} <a href="{page}?case={k}" target="_blank">직접 열기</a></h3><div class="r">')
        for f in imgs:
            vp=re.search(r'(\d+x\d+)',f).group(1)
            out.append(f'<figure><a href="shots/cases/{f}" target="_blank"><img loading="lazy" src="shots/cases/{f}" alt="{k} {vp}"></a><figcaption>{vp}</figcaption></figure>')
        out.append('</div></section>')
    out.append('</div>'); return '\n'.join(out)
doc=f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>클래스 진행 화면 · 케이스 갤러리 (A안)</title>
<style>body{{margin:0;background:#12081C;color:#F2EAF8;font:15px/1.5 -apple-system,"Apple SD Gothic Neo",Pretendard,sans-serif;padding:24px}}h1{{font-size:24px;margin:0 0 4px}}h2{{margin:32px 0 12px;font-size:20px;border-bottom:1px solid #3a2a4d;padding-bottom:8px}}h3{{font-size:15px;margin:0 0 8px}}a{{color:#D2AEFC}}nav a{{margin-right:14px}}.g{{display:grid;gap:18px}}section{{background:#1d1130;border:1px solid #3a2a4d;border-radius:16px;padding:14px}}.r{{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}}figure{{margin:0}}figure img{{display:block;height:320px;width:auto;border-radius:10px;border:1px solid #3a2a4d}}figcaption{{font-size:12px;color:#a99bb8;margin-top:4px}}p{{color:#a99bb8;margin:4px 0}}</style>
<h1>클래스 진행 화면 · 케이스 갤러리 (A안 · 좌우 균형 적용)</h1><p>회원 M01~M21 · 상담사 C01~C18 × 4개 뷰포트(390 · 834 · 1194 · 1280). 이미지를 누르면 원본, "직접 열기"는 동작하는 시안(?case=ID).</p>
<nav><a href="#m">회원</a><a href="#c">상담사</a><a href="균형.md">균형.md</a><a href="케이스.md">케이스.md</a><a href="shots/cases/member-symmetry.txt">회원 대칭 측정</a><a href="shots/cases/counselor-symmetry.txt">상담사 대칭 측정</a></nav>
<div id="m">{sec("member",M,"member.html","회원 화면")}</div><div id="c">{sec("counselor",C,"counselor.html","상담사 화면")}</div></html>'''
open(os.path.join(here,'cases.html'),'w').write(doc)
print(doc.count('<img'))
