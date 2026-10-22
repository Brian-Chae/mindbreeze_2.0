// 원본 측정/SDD-233 parity 로직은 그대로 사용하고 산출물만 A 영역에 저장한다.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const parity = process.argv.includes('--parity');
const source = path.resolve(__dirname, parity ? '../sdd-233-home-stats-floating-nav/parity.cjs' : 'measure.cjs');
let code = fs.readFileSync(source, 'utf8');
if (parity) {
  code = code.replace("const out = path.join(__dirname, 'screens');", `const out = ${JSON.stringify(path.join(__dirname, 'screens/parity-a'))};`);
  if(process.argv.includes('--rail-contract')){
    code=code.replace("panelsAll:all('.mh-main>section,.mh-rail>section,.ch-panel')", "panelsAll:all('.mh-main>section,.mh-rail>section:not(.home-rail-card),.ch-panel:not(.home-rail-card)'),railAll:all('.home-rail-card')");
    code=code.replace("if(m.tilesAll.length!==4", "for(const x of [m,c])for(const card of x.railAll)if(card.minHeight!=='0px')failures.push(width+' rail minHeight');\n if(m.tilesAll.length!==4");
    code=code.replace('screens/parity-a', 'screens/parity-a-rail-contract');
  }
} else {
  code = code.replace('results.push(result);', `
  if(width<=767){
    const fit=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('.mh-track>.mc-card,.mh-summary>button,.ch-tiles>a')];
      return cards.map(card=>{const r=card.getBoundingClientRect();const c=getComputedStyle(card);const children=[...card.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().height>0);return {class:card.className,height:r.height,bottomInset:Math.min(...children.map(el=>r.bottom-el.getBoundingClientRect().bottom)),scrollHeight:card.scrollHeight,clientHeight:card.clientHeight,padding:c.padding};});
    });
    await page.locator('.mh-track>.mc-card').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,file+'-cards.png')});
    await page.evaluate(()=>{
      const title=document.querySelector('.sh-hero__title');if(title)title.textContent='아주 긴 한글 클래스 제목과 함께하는 편안한 호흡 명상 https://example.test/'+ 'long'.repeat(24);
      const els=[...document.querySelectorAll('.mh-home *, .ch-home *')];
      const sizes=els.map(el=>parseFloat(getComputedStyle(el).fontSize));
      els.forEach((el,i)=>el.style.fontSize=sizes[i]*2+'px');
    });
    const stress=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,cta:[...document.querySelectorAll('.sh-hcta')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))}));
    fs.writeFileSync(path.join(out,file+'-fit.json'),JSON.stringify({fit,stress},null,2));
  }
  results.push(result);`);
}
const runner = new Module(source, module);
runner.filename = source;
runner.paths = Module._nodeModulePaths(path.dirname(source));
runner._compile(code, source);
