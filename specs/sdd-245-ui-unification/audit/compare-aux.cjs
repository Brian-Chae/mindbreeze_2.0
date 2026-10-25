// SDD-245 UI-03: 768/1024/1920 보조 폭 — 홈 변경 전후 비교, 가로 넘침, 본문 시작선(홈 대비).
const fs=require('node:fs'),path=require('node:path');
const [A,B]=[process.argv[2],process.argv[3]]; // before, after
const homeId={client:'app',counselor:'dashboard',org_admin:'dashboard-org',platform_admin:'admin-orgs'};
const rd=(d,id)=>JSON.parse(fs.readFileSync(path.join(d,'measurements',id+'.json')));
const left=m=>{const w=(m.wrappers||[]).find(x=>x.width>0);const c=m.content;return c?c.x+c.paddingLeft:null};
const out=[];let overflow=0,n=0;
for(const f of fs.readdirSync(path.join(B,'measurements'))){const id=f.replace('.json','');const a=rd(A,id),b=rd(B,id);n++;
 if(b.scrollWidth>b.width+1){overflow++;out.push(`넘침 ${id} scrollWidth ${b.scrollWidth} > ${b.width}`)}}
let homeDiff=0;
for(const w of [768,1024,1920])for(const r of ['client','counselor']){const id=`${r}-${w}-${homeId[r]}`;const a=rd(A,id),b=rd(B,id);
 const keys=['x','y','width','height','paddingLeft','paddingRight','paddingTop','paddingBottom','fontSize'];
 for(const g of ['content','title'])for(const k of keys)if(Math.abs((a[g]?.[k]||0)-(b[g]?.[k]||0))>0.5){homeDiff++;out.push(`홈 ${id}.${g}.${k} ${a[g][k]} → ${b[g][k]}`)}
 for(const l of ['wrappers','controls','cards'])if((a[l]||[]).length!==(b[l]||[]).length){homeDiff++;out.push(`홈 ${id}.${l} 개수`)}else a[l].forEach((e,i)=>{for(const k of ['x','width','height','paddingLeft','radius'])if(String(e[k])!==String(b[l][i][k])&&!(typeof e[k]==='number'&&Math.abs(e[k]-b[l][i][k])<=0.5)){homeDiff++;out.push(`홈 ${id}.${l}[${i}].${k} ${e[k]} → ${b[l][i][k]}`)}});}
console.log(`보조 폭 표본 ${n}개, 가로 넘침 ${overflow}개, 회원·상담사 홈(768/1024/1920) 변경 ${homeDiff}건`);
// 본문 시작선: 같은 역할·폭의 홈 대비
const rows=[];for(const f of fs.readdirSync(path.join(B,'measurements'))){const id=f.replace('.json','');const b=rd(B,id);const hid=`${b.role}-${b.width}-${homeId[b.role]}`;if(id===hid)continue;const h=rd(B,hid);
 const bl=(b.content?b.content.x+b.content.paddingLeft:null),hl=(h.content?h.content.x+h.content.paddingLeft:null);rows.push(`${id}: 셸 시작선 ${bl} / 홈 셸 ${hl}`)}
out.slice(0,40).forEach(l=>console.log(' -',l));console.log(rows.join('\n'));
