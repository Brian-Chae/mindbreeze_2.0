// 원시 JSON을 보존하며 측정 공통 필드만 비교한다. before에는 tag/inputType이 없다.
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, 'screens');
const fields = ['fontSize','lineHeight','fontWeight','fontFamily','width','height','x','y','padding','margin','gap'];
const failures = [], rows = [];
for (const file of fs.readdirSync(path.join(dir,'after-c')).filter(file => /^C-.+-\d+\.json$/.test(file))) {
 const after = JSON.parse(fs.readFileSync(path.join(dir,'after-c',file)));
 const before = JSON.parse(fs.readFileSync(path.join(dir,'before',file)));
 if(after.failure || after.errors.length || after.unknown.length || after.scrollWidth > after.width) failures.push(file+': 렌더/가로 넘침');
 let compared = 0;
 if(after.width >= 768) for(const group of ['texts','touches','spacing']) {
   if(before[group].length !== after[group].length) failures.push(file+': '+group+' 길이');
   after[group].forEach((item,index) => fields.forEach(field => {
     compared++;
     if(item[field] !== before[group][index]?.[field]) failures.push(`${file}: ${group}[${index}].${field}`);
   }));
 }
 if(after.width === 390 && (after.summary.smallTextCount || after.summary.smallTouchCount || after.summary.narrowTouchCount)) failures.push(file+': 모바일 하한');
 rows.push({file,compared,scrollWidth:after.scrollWidth,...after.summary});
}
console.log(JSON.stringify({rows,failures},null,2));
if(failures.length) process.exitCode=1;
