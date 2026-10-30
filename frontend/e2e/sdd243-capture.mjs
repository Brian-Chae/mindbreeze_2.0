// 서버 프로세스 없이 실제 빌드 앱을 Chrome에 제공한다. 모든 API는 합성 계약 fixture다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = path.join(root, 'specs/sdd-243-platform-data-center/contracts/fixtures');
const output = path.join(root, 'specs/sdd-243-platform-data-center/captures-impl');
const fixture = name => JSON.parse(fs.readFileSync(path.join(fixtures, name + '.json'), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], checks = [], errors = [], requests = [];
const check = (name, pass) => { checks.push({ name, pass }); if (!pass) throw new Error(name); };
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html' };
for (const role of ['platform_admin', 'org_admin']) {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, serviceWorkers: 'block' });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    let activeExportRequest = null;
    page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR',error.message); });
    await context.addInitScript(({ role }) => localStorage.setItem('mb_user', JSON.stringify({ id: 'synthetic-admin', name: '합성 관리자', email: 'admin@example.invalid', role, verified_tier: 'verified', onboarding_completed: true, counselors: [], auth_provider: 'email' })), { role });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      const json = body => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://sdd243.local', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,idempotency-key', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
      if (route.request().method() === 'OPTIONS') return json({});
      if (p.includes('/api/')) {
        requests.push({ role, width, method: route.request().method(), path: p, query: url.search });
        if (p.endsWith('/auth/refresh')) return json({ access_token: 'synthetic-only', token_type: 'bearer' });
        const dc = p.split('/data-center')[1];
        if (dc !== undefined) {
          if (dc === '/contexts') {
            const ctx = fixture('context');
            ctx.role = role;
            if (role === 'platform_admin') { ctx.current_org = null; ctx.default_org_id = null; ctx.capabilities.tabs = ['overview','subjects','classes','consents','retention','standard','jobs','audits']; ctx.capabilities.can_research = true; ctx.capabilities.can_view_platform_audits = true; }
            return json(ctx);
          }
          if (dc === '/summary') return json(fixture('summary'));
          if (dc === '/classes') { const body = fixture('class-list'); if (url.searchParams.get('q') === '검색결과없음') { body.items=[]; body.total=0; } return json(body); }
          if (/\/classes\/[^/]+\/sessions/.test(dc)) return json(fixture('class-sessions'));
          if (/\/sessions\/[^/]+\/participants/.test(dc)) return json(fixture('session-participants'));
          if (dc === '/subjects') { const body = fixture('subjects'); if (url.searchParams.get('role') === 'counselor') { body.items[0].role = 'counselor'; body.items[0].display_name = '합성 진행자'; } return json(body); }
          if (dc.endsWith('/contact-reveal')) return json({ phone: '010-0000-0000', birth_date: null, unavailable: ['birth_date'] });
          if (dc.endsWith('/holdings')) return json({ subject_type: 'user', subject_id: fixture('subjects').items[0].subject_id, as_of: fixture('summary').as_of, events: [], counts: fixture('subjects').items[0].holdings, next_cursor: null });
          if (/\/(members|facilitators)\/[^/]+\/sessions/.test(dc)) return json({ subject_type: 'user', subject_id: fixture('subjects').items[0].subject_id, sessions: fixture('class-sessions').sessions, batches: [{ batch_no: 1, start_ordinal: 1, end_ordinal: 1, session_count: 1 }], max_sessions_per_request: 50 });
          if (dc.endsWith('/waveform')) { const body = fixture('waveform'); const signal = url.searchParams.get('signal_type'); body.from_us = url.searchParams.get('from_us') || body.from_us; body.to_us = url.searchParams.get('to_us') || body.to_us; if (signal !== 'eeg') Object.assign(body, { signal_type: signal, availability: signal === 'ppg' ? 'unsupported_client' : 'not_collected', unavailable_reason: signal === 'ppg' ? '구 앱 미지원' : '미수집', method: 'none', channels: [], t_us: [], segments: [], gaps: [], returned_count: 0 }); return json(body); }
          if (dc.endsWith('/features')) return json(fixture('features'));
          if (dc.endsWith('/indices')) return json(fixture('indices'));
          if (dc.endsWith('/spectrum')) return json(fixture('spectrum'));
          if (/\/measurements\/[^/]+\/[^/]+$/.test(dc)) return json(fixture('measurement-detail'));
          if (dc === '/exports/preview') { const body = fixture('export-preview'); const req = route.request().postDataJSON(); activeExportRequest=req; Object.assign(body, { scope: req.scope, identity: req.identity, purpose: req.purpose, session_count:req.scope==='class'?12:1, participant_count:req.scope==='participant'?1:2, expires_at: new Date(Date.now() + 300000).toISOString() }); return json(body); }
          if (dc === '/export-reauth') return json({ proof: 'synthetic-export-proof', expires_at: new Date(Date.now() + 300000).toISOString() });
          if (dc === '/exports' && route.request().method() === 'POST') return json({ ...fixture('export-status'), status: 'queued', parts: [], expires_at: new Date(Date.now() + 86400000).toISOString() });
          if (dc === '/download-audits') return json({ items: [{ event_id:'synthetic-audit-1', event:'url_issued', result:'allowed', at:fixture('summary').as_of, actor_id:fixture('context').actor_id, actor_role:role,org_id:role==='org_admin'?fixture('context').current_org.id:null, job_id:fixture('export-status').export_id, purpose:'operations', identity:'pseudonymized',reason:'합성 운영 점검',part_no:1,session_count:12,size_bytes:48000000,policy_version:'dc-policy-1' }],next_cursor:null });
          if (dc === '/exports') return json({ items: [{ ...fixture('export-status'), scope:activeExportRequest?.scope || 'class', session_count:activeExportRequest?.scope==='class'?12:1, expires_at: new Date(Date.now() + 86400000).toISOString() }], next_cursor: null, total: 1, as_of: fixture('summary').as_of });
          if (dc.startsWith('/exports/')) return json({ ...fixture('export-status'), scope:activeExportRequest?.scope || 'class', session_count:activeExportRequest?.scope==='class'?12:1, expires_at: new Date(Date.now() + 86400000).toISOString() });
          return json({ items: [], next_cursor: null, total: 0, as_of: fixture('summary').as_of });
        }
        return json({ items: [], rooms: [], reports: [], total: 0, unread: 0, unread_count: 0 });
      }
      if (url.hostname === 'sdd243.local') {
        const assetPath = path.join(root, 'frontend/dist', p);
        const file = path.extname(p) && fs.existsSync(assetPath) ? assetPath : path.join(root, 'frontend/dist/index.html');
        if (fs.existsSync(file)) return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      }
      return route.abort();
    });
    const prefix = `${role}-${width}`;
    async function snap(name) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, `${prefix}-${name}.png`), fullPage: true });
      const fit = await page.evaluate(() => { const dialog=document.querySelector('[role=dialog]');const r=dialog?.getBoundingClientRect();return { overflow: document.documentElement.scrollWidth-innerWidth,bodyWidth:document.body.scrollWidth,width:innerWidth,modal:r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom}:null }; });
      results.push({ role, width, name, ...fit });
      check(`${prefix}-${name} 페이지 가로 넘침 없음`, fit.overflow <= 1);
      if(fit.modal) check(`${prefix}-${name} 대화상자 화면 내 배치`,fit.modal.left>=0&&fit.modal.right<=width&&fit.modal.top>=0&&fit.modal.bottom<=(width===390?844:1000));
    }
    await page.goto(`https://sdd243.local/${role === 'platform_admin' ? 'admin' : 'org'}/data-center`);
    await page.getByRole('heading', { name: /데이터 센터$/ }).first().waitFor();
    await page.getByRole('button', { name: /회차 보기/ }).first().waitFor({timeout:10000}).catch(async error => { console.log(await page.locator('body').innerText()); console.log(JSON.stringify({ errors,requests })); await page.screenshot({path:path.join(output,'debug.png')}); throw error; });
    check(`${prefix} 역할별 기관·탭`, role === 'platform_admin' ? await page.getByRole('button',{name:'보관·삭제',exact:true}).count() === 1 : await page.getByRole('button',{name:'보관·삭제',exact:true}).count() === 0);
    await snap('classes');
    await page.getByLabel('데이터 검색').fill('검색결과없음');
    await page.getByText('검색 조건에 맞는 데이터가 없습니다').waitFor();
    check(`${prefix} 검색 빈 상태`, await page.getByText('검색 조건에 맞는 데이터가 없습니다').isVisible());
    await page.getByRole('button',{name:'필터 초기화',exact:true}).click();
    await page.getByRole('button',{name:/회차 보기/}).first().waitFor();
    // 실제 컴포넌트의 접근 가능한 버튼으로 탐색한다.
    await page.getByRole('button', { name: /회차 보기/ }).first().click();
    await page.getByRole('button', { name: /참여자 보기/ }).first().waitFor();
    await snap('sessions');
    await page.getByRole('button', { name: /참여자 보기/ }).first().click();
    await page.getByRole('button', { name: /측정 상세/ }).first().waitFor();
    await snap('participants');
    if (process.env.CAPTURE_STAGE === 'F01') { await context.close(); continue; }
    await page.getByRole('button', { name: /측정 상세/ }).first().click();
    await page.getByText('6대 지표 시계열', { exact: false }).first().waitFor();
    await page.getByRole('tab',{name:'EEG 원파형',exact:true}).scrollIntoViewIfNeeded();
    await snap('measurement');
    await page.locator('.dc-wave-frame').first().scrollIntoViewIfNeeded(); await snap('eeg-waveform');
    await page.locator('.dc-indices-grid').scrollIntoViewIfNeeded(); await snap('indices');
    await page.getByLabel('원파형표시 구간').selectOption('30');
    await page.getByText('선택 0–30초', {exact:false}).waitFor();
    check(`${prefix} 30초 범위`, requests.some(r=>r.role===role && r.width===width && r.path.endsWith('/waveform') && r.query.includes('to_us=30000000')));
    for(const signal of ['PPG','ACC']) { await page.getByRole('tab',{name:`${signal} 원파형`,exact:true}).click(); await page.getByText(`${signal} · 미수집 / 원파형 없음`,{exact:true}).waitFor(); await page.locator('.dc-measure-empty').scrollIntoViewIfNeeded(); await snap(`measurement-${signal.toLowerCase()}`); }
    await page.getByRole('tab',{name:'feature 표',exact:true}).click(); await page.getByText('1.234567890123',{exact:true}).waitFor(); await snap('features');
    if(process.env.CAPTURE_STAGE !== 'F02') { await page.getByRole('button',{name:'다운로드 설정',exact:true}).click(); await page.getByRole('dialog').waitFor(); await snap('participant-range-dialog'); await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click(); }
    await page.getByRole('button',{name:'닫기',exact:true}).first().click();
    if (process.env.CAPTURE_STAGE !== 'F02') {
      await page.getByRole('button',{name:'다운로드 설정',exact:true}).click(); await page.getByRole('dialog').waitFor(); await snap('download-dialog');
      await page.getByLabel('다운로드 사유').fill('합성 데이터 운영 점검');
      await page.getByRole('button',{name:'범위 미리보기',exact:true}).click();
      await page.getByLabel('제외 범위를 확인했습니다').check();
      check(`${prefix} 재인증 전 생성 차단`, await page.getByRole('button',{name:'다운로드 작업 생성',exact:true}).isDisabled());
      await page.getByLabel('재인증 비밀번호 또는 SSO 확인 값').fill('synthetic-credential');
      await page.getByRole('button',{name:'재인증 요청',exact:true}).click();
      await page.getByText('서버가 발급한 재인증 확인 유효',{exact:true}).waitFor();
      await snap('download-preview');
      await page.getByRole('button',{name:'다운로드 작업 생성',exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'hidden'});
      await page.getByRole('button',{name:'다운로드 작업',exact:true}).click();
      await page.getByRole('button',{name:'part1 링크 발급',exact:true}).first().waitFor({timeout:10000}).catch(async error=>{console.log(await page.locator('body').innerText());console.log(JSON.stringify({errors,requests}));throw error;}); await snap('jobs');
      await page.getByRole('button',{name:'다운로드 기록',exact:true}).click();
      await page.getByRole('heading',{name:'다운로드 감사 기록',exact:true}).waitFor(); await page.getByText('합성 운영 점검',{exact:true}).waitFor(); await snap('audits');
      for(const mode of ['회원 단위','코치 단위']) {
        await page.getByRole('button',{name:'클래스 데이터',exact:true}).click();
        await page.getByRole('button',{name:mode,exact:true}).click();
        await page.getByRole('button',{name:/회차 보기/}).first().click();
        await page.getByRole('button',{name:'다운로드 설정',exact:true}).click();
        const dialog=page.getByRole('dialog'); await dialog.waitFor();
        await dialog.getByLabel('시작일',{exact:true}).fill('2026-10-01'); await dialog.getByLabel('종료일',{exact:true}).fill('2026-10-24');
        await snap(mode==='회원 단위'?'member-dialog':'facilitator-dialog');
        await dialog.getByRole('button',{name:'닫기',exact:true}).click();
      }
      await page.getByRole('button',{name:'클래스 데이터',exact:true}).click();
      await page.getByRole('button',{name:'클래스 탐색',exact:true}).click();
      await page.getByRole('button',{name:/회차 보기/}).first().click();
      await page.getByRole('button',{name:'다운로드 설정',exact:true}).click(); await page.getByRole('dialog').waitFor(); await snap('class-dialog');
      await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
    }
    await context.close();
  }
}
const browserVersion=await browser.version();
await browser.close();
fs.writeFileSync(path.join(output, 'capture-results.json'), JSON.stringify({ source: '실제 production build + 모든 API 합성 fixture intercept, 서버 실행 없음', browser: `Chrome ${browserVersion}`, results, checks, errors, requests }, null, 2) + '\n');
console.log(JSON.stringify({ captures: results.length, failed: checks.filter(c => !c.pass), errors }, null, 2));
if (errors.length || checks.some(c => !c.pass)) process.exitCode = 1;
