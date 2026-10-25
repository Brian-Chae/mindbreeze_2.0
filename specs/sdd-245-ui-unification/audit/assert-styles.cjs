// SDD-245 Stage ⑤: 구현 후 재측정 결과를 홈 기준 허용폭(0~1px)으로 판정한다.
// 사용: node assert-styles.cjs --measurements=<AUDIT_OUT> --targets=style-targets.json --tolerance=1
//  선행: python3 summarize.py <AUDIT_OUT> (page-matrix.json 생성)
const fs=require('node:fs'),path=require('node:path');
const arg=k=>(process.argv.find(a=>a.startsWith(`--${k}=`))||'').split('=').slice(1).join('=');
const dir=path.resolve(arg('measurements')||'/tmp/sdd245-after');
const targets=JSON.parse(fs.readFileSync(path.resolve(arg('targets')||path.join(__dirname,'style-targets.json'))));
const tol=Number(arg('tolerance')||targets.tolerance);
const matrix=JSON.parse(fs.readFileSync(path.join(dir,'page-matrix.json')));
const OUT_OF_SCOPE={'권한 안내':'권한 안내 상태 화면 — 정상 페이지 측정 아님','토큰 미제공 안내':'토큰 미제공 안내 상태 화면 — 정상 페이지 측정 아님','시안(비범위)':'시안 /design/* 은 제품 이관 대상 아님','플레이어(제외 제안)':'몰입 플레이어 제외(D1)','의도된 404':'의도된 404 안내'};
const indep=targets.independentLayouts.map(x=>({re:new RegExp(x.route),reason:x.reason}));
const rows=[];const count={PASS:0,'EXC-READING':0,'EXC-INDEPENDENT':0,FAIL:0,OUT:0};
for(const r of matrix){
 const m=JSON.parse(fs.readFileSync(path.join(dir,'measurements',r.id+'.json')));
 const url=r.url.replace(/\?.*/,'');
 const row={id:r.id,url:r.url,role:r.role,width:r.width,status:r.status};
 if(OUT_OF_SCOPE[r.status]){row.verdict='OUT';row.reason=OUT_OF_SCOPE[r.status];count.OUT++;rows.push(row);continue}
 if(r.role==='public'){row.verdict='EXC-INDEPENDENT';row.reason='공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용';count['EXC-INDEPENDENT']++;rows.push(row);continue}
 const homeLeft=r.homeMetrics.contentLeft,left=r.metrics.contentLeft,delta=left==null?null:left-homeLeft;
 row.contentLeft=left;row.homeLeft=homeLeft;row.delta=delta;row.maxWidth=r.metrics.maxWidth;
 const c=m.content,shellStart=c?c.x+c.paddingLeft:null;row.shellStart=shellStart;
 const mw=parseFloat(r.metrics.maxWidth);const narrow=Number.isFinite(mw)&&mw<(targets.frameContentMax||1200)&&/px$/.test(String(r.metrics.maxWidth));
 const ind=indep.find(i=>i.re.test(url));
 const edgeDelta=r.metrics.frameX==null?null:r.metrics.frameX-homeLeft;
 if(delta!=null&&Math.abs(delta)<=tol){row.verdict='PASS';count.PASS++}
 else if(edgeDelta!=null&&Math.abs(edgeDelta)<=tol&&r.metrics.framePaddingLeft>0){row.verdict='PASS';row.reason='프레임 외곽 x가 홈과 일치(자체 카드 padding은 내부)';count.PASS++}
 else if(narrow&&shellStart!=null&&Math.abs(shellStart-homeLeft)<=tol){row.verdict='EXC-READING';row.reason=`읽기·폼 폭 ${r.metrics.maxWidth} 중앙 정렬 유지(D3), 셸 시작선 ${shellStart}=홈 ${homeLeft}`;count['EXC-READING']++}
 else if(ind){row.verdict='EXC-INDEPENDENT';row.reason=ind.reason;count['EXC-INDEPENDENT']++}
 else{row.verdict='FAIL';count.FAIL++}
 // 제목 규격(셸 제목이 있는 표본만)
 const t=r.metrics;if(t.titleFont!=null){row.titleOk=t.titleFont===targets.title.fontSize&&String(t.titleWeight)===targets.title.fontWeight;row.title=`${t.titleFont}/${t.titleWeight}`}
 rows.push(row);
}
const evaluated=rows.length-count.OUT;
const strict=count.PASS,withExc=count.PASS+count['EXC-READING']+count['EXC-INDEPENDENT'];
const titled=rows.filter(r=>r.verdict!=='OUT'&&r.titleOk!==undefined),titleOk=titled.filter(r=>r.titleOk).length;
const summary={total:rows.length,evaluated,out:count.OUT,...count,strictRate:`${strict}/${evaluated}`,withApprovedExceptions:`${withExc}/${evaluated}`,titleSamples:titled.length,titleOk,tolerance:tol};
fs.writeFileSync(path.join(dir,'assert-result.json'),JSON.stringify({summary,rows},null,2));
const md=['# 홈 대비 허용폭 충족표',`허용폭 ±${tol}px · 총 ${rows.length}표본 · 평가 ${evaluated} · 범위 밖 ${count.OUT}`,'',`- 엄격 충족(본문 시작선 홈 대비 ±${tol}px): **${strict}/${evaluated}**`,`- 승인 예외 포함(읽기 폭 ${count['EXC-READING']} + 독립 레이아웃 ${count['EXC-INDEPENDENT']}): **${withExc}/${evaluated}**`,`- 미충족(FAIL): **${count.FAIL}**`,`- 제목 22/700: ${titleOk}/${titled.length}`,'','| 판정 | 경로 | 역할 | 폭 | 본문 시작선 | 홈 | Δ | 사유 |','|---|---|---|---:|---:|---:|---:|---|'];
for(const r of rows.filter(r=>r.verdict!=='PASS'))md.push(`| ${r.verdict} | \`${r.url}\` | ${r.role} | ${r.width} | ${r.contentLeft??'-'} | ${r.homeLeft??'-'} | ${r.delta??'-'} | ${r.reason||''} |`);
fs.writeFileSync(path.join(dir,'assert-result.md'),md.join('\n')+'\n');
console.log(JSON.stringify(summary));
if(count.FAIL){console.log('미승인 편차:');rows.filter(r=>r.verdict==='FAIL').forEach(r=>console.log(` - ${r.role} ${r.width} ${r.url} Δ${r.delta} (mw ${r.maxWidth})`));process.exit(1)}
