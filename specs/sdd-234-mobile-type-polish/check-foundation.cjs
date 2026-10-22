// 화면별 raw JSON을 다시 읽는 독립 검증. 측정 스크립트의 요약값을 신뢰하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const phase = process.argv[2] || 'after';
const dir = path.join(__dirname,'screens',phase);
const failures = [];
const files = fs.readdirSync(dir).filter(x=>/^[ABCD]-.+-\d+\.json$/.test(x));
let desktopChecks=0,mobileChecks=0;
for(const file of files){
 const x=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
 if(x.failure||x.errors.length)failures.push(`${file}: 렌더 실패`);
 if(x.width<768){
  if(x.scrollWidth>x.width)failures.push(`${file}: 문서 가로 넘침`);
  for(const t of x.touches.filter(t=>['메뉴 열기','홈으로 이동','알림'].includes(t.text))){mobileChecks++;if(t.height<44||t.width<44)failures.push(`${file}: ${t.text} ${t.width}x${t.height}`);}
  for(const t of x.texts.filter(t=>t.selector.includes('nav')&&['홈','내 클래스','클래스','대화','리포트','더보기'].includes(t.text))){mobileChecks++;if(t.fontSize<13)failures.push(`${file}: 하단 ${t.text} ${t.fontSize}px`);}
 }else{
  const before=JSON.parse(fs.readFileSync(path.join(__dirname,'screens/before',file),'utf8'));
  for(const key of ['texts','touches','spacing']){
   const stable=rows=>rows.map(({selector,text,fontSize,lineHeight,fontWeight,width,height,padding,margin,gap})=>({selector,text,fontSize,lineHeight,fontWeight,width,height,padding,margin,gap}));
   desktopChecks++;
   if(JSON.stringify(stable(before[key]))!==JSON.stringify(stable(x[key])))failures.push(`${file}: 데스크톱 ${key} 계산 스타일 변경`);
  }
 }
}
const result={phase,screenCount:files.length,mobileChecks,desktopChecks,failures};
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exitCode=1;
