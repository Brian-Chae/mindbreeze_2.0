import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'specs/sdd-237-class-end-host-flow/screens/fe');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const findings = [];
const errors = [];
const states = ['normal','single','unworn','pending','partial','poor','lost','error','zero'];
try {
  for (const width of [390,1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId:'Asia/Seoul' });
    await context.addInitScript(() => localStorage.setItem('mb_user', JSON.stringify({id:'fixture-counselor',name:'상담사',email:'fixture@example.invalid',role:'counselor',verified_tier:'verified',onboarding_completed:true,auth_provider:'local',counselors:[]})));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/auth/refresh')) return route.fulfill({ json: { access_token:'fixture-only' } });
      if (url.hostname === '127.0.0.1' && url.port === '5197') return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const screen of ['summary','class-report']) {
      for (const state of states) {
        await page.goto(`http://127.0.0.1:5197/sessions/fixture-session/${screen}?mock=${state}`);
        await page.locator('[data-section="S1"]').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);
        const file = `${screen}-${state}-${width}.png`;
        await page.screenshot({ path:path.join(output,file), fullPage:true });
        const audit = await page.evaluate(() => {
          const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
          const scope = document.querySelector('.ss-page, .cr-report');
          const smallText = [...(scope ?? document.body).querySelectorAll('*')].filter(el => visible(el) && [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 13).map(el => ({ tag:el.tagName, text:el.textContent.slice(0,60), size:getComputedStyle(el).fontSize }));
          const smallTouch = [...(scope ?? document.body).querySelectorAll('button,a,input,select,textarea,summary')].filter(el => visible(el) && !el.closest('[aria-hidden="true"]') && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).map(el => ({tag:el.tagName,text:el.textContent.slice(0,60),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
          return {overflow:document.documentElement.scrollWidth>innerWidth,smallText,smallTouch};
        });
        findings.push({screen,state,width,file,...audit});
      }
    }
    await page.goto(`http://127.0.0.1:5197/sessions/fixture-session/class-report?mock=normal`);
    await page.locator('[data-section="S1"]').waitFor();
    await page.getByRole('button',{name:'수정',exact:true}).first().click();
    await page.screenshot({path:path.join(output,`class-report-editing-${width}.png`),fullPage:true});
    await page.getByRole('textbox', { name:'서사 문장 수정' }).fill('오늘 수업에서 관찰한 흐름을 함께 기록했어요.');
    await page.getByRole('button', { name:'저장', exact:true }).click();
    await page.getByText('저장됨', {exact:true}).waitFor();
    if (!(await page.locator('[data-section="S1"]').textContent()).includes('코치 수정')) throw new Error('저장 후 출처 전환 누락');
    await page.getByRole('button',{name:'AI 초안으로 되돌리기',exact:true}).first().click();
    await page.getByRole('button',{name:'되돌리기',exact:true}).click();
    await page.locator('[data-section="S1"]').getByText('AI 요약',{exact:true}).waitFor();
    await page.locator('[data-metric="respiration"] summary').click();
    await page.screenshot({path:path.join(output,`class-report-evidence-${width}.png`),fullPage:true});
    await context.close();
  }
  await writeFile(path.join(output,'audit.json'),JSON.stringify({findings,errors},null,2));
  const required = [['summary','normal','narrative-normal'],['summary','single','narrative-single'],['summary','unworn','narrative-unworn'],['class-report','normal','narrative-report'],['class-report','pending','narrative-report-pending'],['class-report','editing','narrative-report']];
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>SDD-237 FE 시안 비교</title><style>body{font:16px sans-serif;background:#eee;margin:24px}section{margin-bottom:50px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}img{width:100%;height:auto;background:white}h2{margin-top:48px}</style><h1>시안(왼쪽) / 실제 앱 fixture(오른쪽)</h1><p>수치는 API 계약 합성 데이터이며 시안과 다를 수 있어요. 수정 중은 확정 시안에 없는 승인 추가 상태예요.</p>${[390,1440].flatMap(width=>required.map(([screen,state,design])=>`<section><h2>${screen} · ${state} · ${width}px</h2><div class="pair"><div><h3>확정 시안</h3><img src="../../../../designs/class-end-host-flow/screenshots/${design}-${width}.png"></div><div><h3>실제 앱</h3><img src="${screen}-${state}-${width}.png"></div></div></section>`)).join('')}</html>`;
  await writeFile(path.join(output,'index.html'),html);
  const failed = findings.filter(x=>x.overflow||x.smallText.length||x.smallTouch.length);
  console.log(JSON.stringify({screenshots:findings.length+4,failed,errors},null,2));
  if (failed.length || errors.length) process.exitCode=1;
} finally { await browser.close(); }
