// SDD-245: 구현 전(measurements)과 후(AUDIT_OUT/measurements) 홈 8표본의 계산 스타일/좌표를 비교한다. 홈 회귀 0px 게이트.
const fs=require('node:fs'),path=require('node:path');
const after=path.resolve(process.argv[2]||'/tmp/sdd245-after-A');
const before=path.join(__dirname,'measurements');
const ids=['client','counselor','org_admin','platform_admin'].flatMap(r=>[390,1440].map(w=>`${r}-${w}-${{client:'app',counselor:'dashboard',org_admin:'dashboard-org',platform_admin:'admin-orgs'}[r]}`));
const NUM=['x','y','width','height','paddingLeft','paddingRight','paddingTop','paddingBottom','marginTop','marginBottom','fontSize','lineHeight'];
const STR=['radius','shadow','borderWidth','borderColor','fontWeight','color','background','gap'];
const groups=['content','title'];const lists=['wrappers','headings','controls','cards','inputs','chips','sections'];
let total=0,bad=0;const out=[];
const cmp=(a,b,where)=>{if(!a||!b){if(a!==b){bad++;out.push(`${where}: 요소 유무 차이`)}return}
 for(const k of NUM){total++;const d=Math.abs((a[k]||0)-(b[k]||0));if(d>0.5){bad++;out.push(`${where}.${k}: ${a[k]} → ${b[k]}`)}}
 for(const k of STR){total++;if(String(a[k])!==String(b[k])){bad++;out.push(`${where}.${k}: ${a[k]} → ${b[k]}`)}}};
for(const id of ids){
 const A=JSON.parse(fs.readFileSync(path.join(before,id+'.json'))),B=JSON.parse(fs.readFileSync(path.join(after,'measurements',id+'.json')));
 const a=A.measurement||A,b=B.measurement||B;
 for(const g of groups)cmp(a[g],b[g],`${id}.${g}`);
 for(const l of lists){const la=a[l]||[],lb=b[l]||[];if(la.length!==lb.length){bad++;out.push(`${id}.${l}: 개수 ${la.length} → ${lb.length}`);continue}
  la.forEach((e,i)=>cmp(e,lb[i],`${id}.${l}[${i}]`))}
 total++;if((a.scrollWidth||0)!==(b.scrollWidth||0)){bad++;out.push(`${id}.scrollWidth ${a.scrollWidth} → ${b.scrollWidth}`)}
}
console.log(`홈 8표본 비교 항목 ${total}개 중 차이 ${bad}개`);out.slice(0,60).forEach(l=>console.log(' -',l));
process.exit(bad?1:0);
