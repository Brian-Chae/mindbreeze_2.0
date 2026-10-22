"""Chrome에서 텍스트만 투명하게 만든 합성 화면의 각 텍스트 사각형 전체 픽셀을 측정한다."""
from pathlib import Path
from PIL import Image
import json, math, re
root=Path(__file__).parent
metrics=json.loads((root/'capture-metrics.json').read_text())
def luminance(rgb):
    c=[v/255 for v in rgb[:3]]
    c=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c]
    return .2126*c[0]+.7152*c[1]+.0722*c[2]
def contrast(fg,bg):
    a,b=sorted((luminance(fg),luminance(bg)))
    return (b+.05)/(a+.05)
report=[]
for item in metrics['viewportChecks']:
    im=Image.open('/tmp/checkin-'+item['id']+'-background.png').convert('RGB');values=[]
    for r in item['rects']:
        fg=tuple(map(int,re.findall(r'\d+',r['color'])[:3]))
        box=(max(0,math.ceil(r['x'])),max(0,math.ceil(r['y'])),min(im.width,math.floor(r['x']+r['width'])),min(im.height,math.floor(r['y']+r['height'])))
        colors=set(im.crop(box).getdata())
        worst=min((contrast(fg,bg),bg) for bg in colors)
        values.append(dict(text=r['text'],ratio=round(worst[0],3),foreground=fg,worstBackground=worst[1]))
    minimum=min(v['ratio'] for v in values)
    report.append(dict(id=item['id'],minimum=minimum,textMeasurements=values))
(root/'contrast-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for v in ['before','after']:
    vals=[r['minimum'] for r in report if r['id'].startswith(v) and ('-focus-' in r['id'] or '-emotion-' in r['id'])]
    print(v,min(vals))
assert all(r['minimum']>=7.8 for r in report if r['id'].startswith('after') and ('-focus-' in r['id'] or '-emotion-' in r['id'])), '텍스트 대비 기준 미달'
