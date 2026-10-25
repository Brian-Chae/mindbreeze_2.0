// SDD-245 Stage ⑤: 버튼 텍스트 AA 대비(일반 4.5:1, 큰 글자 3:1, 컨트롤 경계 3:1) 계산.
// 1) 공용 Button 토큰 조합(normal/hover/focus) 2) 재측정된 실제 컨트롤 전체.
const fs=require('node:fs'),path=require('node:path');
const lin=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const lum=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05)};
const hex=h=>{h=h.replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
const parse=s=>{const m=String(s).match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(',').map(Number);return {rgb:p.slice(0,3),a:p.length>3?p[3]:1}};
const over=(fg,bg)=>fg.a>=1?fg.rgb:fg.rgb.map((v,i)=>Math.round(v*fg.a+bg[i]*(1-fg.a)));
const tokens=[
 ['primary normal','#FFFFFF','#5F0080'],['primary hover','#FFFFFF','#4B0066'],
 ['primary inverse normal','#5F0080','#FFFFFF'],['primary inverse hover','#5F0080','#F4EDF8'],
 ['primary danger normal','#FFFFFF','#B3264B'],['primary danger hover','#FFFFFF','#962041'],
 ['secondary normal','#5F0080','#F4EDF8'],['secondary hover','#5F0080','#EADFF2'],
 ['secondary danger normal','#B3264B','#FDECEF'],['secondary danger hover','#B3264B','#FAD9E0'],
 ['ghost on 페이지 배경 #F7F4F0','#5F0080','#F7F4F0'],['ghost on 흰 카드','#5F0080','#FFFFFF'],['ghost hover','#5F0080','#F4EDF8'],
 ['ghost danger on 흰 카드','#B3264B','#FFFFFF'],['ghost danger hover','#B3264B','#FDECEF'],
 ['icon normal','#1F1F1F','#F2F3F8'],['icon hover','#1F1F1F','#E6E7EF'],
 ['탭 활성','#FFFFFF','#5F0080'],['탭 비활성 on 페이지 배경','#5F0080','#F7F4F0'],
 ['칩','#655173','#F1EDF5'],
 ['입력 placeholder','#6F6F6F','#FFFFFF'],['입력 텍스트','#1F1F1F','#FFFFFF'],
];
const edge=[['입력 경계 #857E8F / 흰','#857E8F','#FFFFFF'],['focus ring #5F0080 / 흰','#5F0080','#FFFFFF'],['focus ring #5F0080 / 페이지 배경','#5F0080','#F7F4F0']];
const md=['# 버튼 AA 대비 (SDD-245)','','## 공용 토큰 조합','| 조합 | 글자 | 배경 | 대비 | 기준 | 판정 |','|---|---|---|---:|---|---|'];
let fail=0;
for(const [n,f,b] of tokens){const r=ratio(hex(f),hex(b));const ok=r>=4.5;if(!ok)fail++;md.push(`| ${n} | ${f} | ${b} | ${r.toFixed(2)} | 4.5 | ${ok?'통과':'미달'} |`)}
md.push('','## 컨트롤 경계·포커스 (3:1)','| 조합 | 전경 | 배경 | 대비 | 판정 |','|---|---|---|---:|---|');
for(const [n,f,b] of edge){const r=ratio(hex(f),hex(b));const ok=r>=3;if(!ok)fail++;md.push(`| ${n} | ${f} | ${b} | ${r.toFixed(2)} | ${ok?'통과':'미달'} |`)}
const dir=process.argv[2]?path.resolve(process.argv[2]):null;
if(dir){
 const worst=new Map();let n=0,bad=0;const bads=[];
 for(const f of fs.readdirSync(path.join(dir,'measurements'))){
  const m=JSON.parse(fs.readFileSync(path.join(dir,'measurements',f)));
  const page=parse(m.content?.background)||{rgb:[247,244,240],a:1};
  for(const c of (m.controls||[])){
   if(c.disabled||!c.text)continue;const fg=parse(c.color),bg0=parse(c.background);if(!fg||!bg0)continue;
   const base=over(bg0,page.rgb),txt=over(fg,base);const r=ratio(txt,base);
   const large=c.fontSize>=24||(c.fontSize>=18.66&&Number(c.fontWeight)>=700);const need=large?3:4.5;
   n++;if(r<need){bad++;bads.push({id:m.id,text:c.text.slice(0,24),kind:c.kind,ratio:+r.toFixed(2),need,color:c.color,background:c.background,fontSize:c.fontSize})}
   const k=c.kind;if(!worst.has(k)||worst.get(k).ratio>r)worst.set(k,{ratio:r,id:m.id,text:c.text.slice(0,24)});
  }
 }
 md.push('','## 재측정 실제 컨트롤(normal) 전체',`- 검사 ${n}개 중 AA 미달 ${bad}개 (투명 배경은 셸 배경색과 합성; 그라데이션/이미지 위 텍스트는 별도 육안)`,'','| 종류 | 최저 대비 | 표본 | 텍스트 |','|---|---:|---|---|');
 for(const [k,v] of worst)md.push(`| ${k} | ${v.ratio.toFixed(2)} | ${v.id} | ${v.text} |`);
 if(bads.length){md.push('','### 미달 목록(상위 40)','| 표본 | 종류 | 텍스트 | 대비 | 기준 | 글자색 | 배경 |','|---|---|---|---:|---:|---|---|');
  const seen=new Set();for(const b of bads){const key=b.text+b.color+b.background;if(seen.has(key))continue;seen.add(key);if(seen.size>40)break;md.push(`| ${b.id} | ${b.kind} | ${b.text} | ${b.ratio} | ${b.need} | ${b.color} | ${b.background} |`)}}
 fs.writeFileSync(path.join(dir,'contrast-result.json'),JSON.stringify({checked:n,bad,bads},null,2));
}
const out=path.join(dir||__dirname,'contrast.md');fs.writeFileSync(out,md.join('\n')+'\n');console.log(md.join('\n'));process.exit(fail?1:0);
