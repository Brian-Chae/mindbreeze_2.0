// 실제 Tailwind 생성 CSS를 Chrome에 넣어 토큰과 767/768 경계를 독립 검증한다.
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../../frontend');
const deps=path.join(root,'node_modules');
const postcss=require(path.join(deps,'postcss'));const tailwind=require(path.join(deps,'tailwindcss'));
const {chromium}=require(path.join(deps,'playwright'));
(async()=>{
 const names=['caption','label','compact','body','subtitle','title','hero','number'];
 const sizes=[13,14,15,16,18,22,24,28],leading=[20,20,24,26,27,30,32,34];
 const html=names.map(n=>`<p id="${n}" class="text-sm mobile:text-mb-${n}">한글 가독성 확인</p>`).join('');
 const config=require(path.join(root,'tailwind.config.cjs'));
 const css=(await postcss([tailwind({...config,content:[{raw:html,extension:'html'}]})]).process('@tailwind utilities;',{from:undefined})).css;
 const base=fs.readFileSync(path.resolve(root,'../design-system/build/outputs/css/tokens.base.css'),'utf8');
 const b=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']});
 const results=[],failures=[];
 try{for(const width of [390,767,768,1440]){const p=await b.newPage({viewport:{width,height:844}});await p.setContent(`<style>${base}\n${css}</style>${html}`);const metrics=await p.locator('p').evaluateAll(es=>es.map(e=>({id:e.id,size:parseFloat(getComputedStyle(e).fontSize),line:parseFloat(getComputedStyle(e).lineHeight)})));metrics.forEach((m,i)=>{if(m.size!==(width<768?sizes[i]:15)||m.line!==(width<768?leading[i]:22))failures.push({width,...m});});results.push({width,metrics});await p.close();}}finally{await b.close();}
 console.log(JSON.stringify({results,failures},null,2));if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
