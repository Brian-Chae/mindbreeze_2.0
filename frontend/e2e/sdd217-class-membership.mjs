/** T11: localhost 실제 API+PG 합성 통합 검증. 토큰·비밀번호는 메모리/0600 임시파일만 사용. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const evidence = path.join(root, 'specs/sdd-217-class-structure-phase4/evidence');
mkdirSync(evidence, {
  recursive: true
});
const BASE = 'http://127.0.0.1:55440',
  API = 'http://127.0.0.1:55439/api/v1';
const seed = JSON.parse(readFileSync('/private/tmp/sdd217-browser-fixture.json', 'utf8'));
const python = '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python';
let run = 0;
try {
  run = Number(readFileSync('/private/tmp/sdd217-browser-run', 'utf8'));
} catch {}
run += 1;
writeFileSync('/private/tmp/sdd217-browser-run', String(run), {
  mode: 0o600
});
const scheduleStart = new Date(Date.UTC(2029, 0, 1 + 28 * run)).toISOString().slice(0, 10);
const layoutOnly = process.argv.includes('--layout-only');
const activeOnly = process.argv.includes('--active-layout-only');
const prior = layoutOnly ? JSON.parse(readFileSync(path.join(evidence, 'T11-browser-results.json'), 'utf8')) : null;
const resultName = activeOnly ? 'T11-active-layout-results.json' : layoutOnly ? 'T11-layout-results.json' : 'T11-browser-results.json';
const results = [],
  requests = [],
  errors = [];
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true
});
const contexts = [];
const safe = value => String(value).replace(/eyJ[A-Za-z0-9_.-]+/g, '[자격 숨김]').replace(/[A-Za-z0-9_-]{32,}/g, '[긴 값 숨김]');
const fixture = (...args) => execFileSync(python, [path.join(dir, 'sdd217-browser-fixture.py'), ...args], {
  encoding: 'utf8',
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://sdd217@127.0.0.1:55437/sdd217_browser'
  }
}).trim();
async function step(name, fn) {
  console.log(`실행: ${name}`);
  try {
    const detail = await fn();
    results.push({
      name,
      status: 'PASS',
      detail: detail?.page ? '실제 로그인 성공' : detail
    });
    console.log(`PASS: ${name}`);
    return detail;
  } catch (e) {
    results.push({
      name,
      status: 'FAIL',
      error: safe(e.message)
    });
    throw e;
  } finally {
    writeFileSync(path.join(evidence, resultName), JSON.stringify({
      synthetic: true,
      base: BASE,
      api: API,
      results,
      requests,
      errors
    }, null, 2));
  }
}
async function actor(key) {
  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 720
    }
  });
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(safe(e.message)));
  page.on('response', r => {
    if (r.url().startsWith(API) || r.url().startsWith(BASE + '/api/')) requests.push({
      method: r.request().method(),
      path: new URL(r.url()).pathname,
      status: r.status()
    });
  });
  let token;
  page.on('response', async r => {
    if (r.url().endsWith('/auth/login') && r.status() === 200) token = (await r.json()).access_token;
  });
  await page.goto(`${BASE}/login?role=${seed[key].role}`);
  await page.locator('input[type=email]').fill(seed[key].email);
  await page.locator('input[type=password]').fill(seed[key].password);
  const response = page.waitForResponse(r => r.url().endsWith('/auth/login'));
  await page.locator('form button[type=submit]').click();
  const lr = await response;
  assert.equal(lr.status(), 200, '실제 로그인 HTTP');
  token = (await lr.json()).access_token;
  await page.waitForURL(url => !url.pathname.includes('login'));
  assert(token, '실제 로그인 token 부재');
  return {
    page,
    context,
    get token() {
      return token;
    },
    key
  };
}
async function req(actor, method, p, body, guest) {
  return actor.page.evaluate(async ({
    API,
    method,
    p,
    body,
    token,
    guest
  }) => {
    const r = await fetch(API + p, {
      method,
      headers: {
        ...(body ? {
          'Content-Type': 'application/json'
        } : {}),
        ...(guest ? {
          'X-Class-Member-Credential': guest
        } : token ? {
          Authorization: 'Bearer ' + token
        } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    let data;
    try {
      data = await r.json();
    } catch {
      data = null;
    }
    return {
      status: r.status,
      data
    };
  }, {
    API,
    method,
    p,
    body,
    token: actor.token,
    guest
  });
}
function ok(r, status = 200) {
  assert.equal(r.status, status, `HTTP ${r.status}: ${safe(JSON.stringify(r.data))}`);
  return r.data;
}
async function snapshot(page, name) {
  await page.evaluate(() => {
    const e = document.createElement('div');
    e.id = 't11-synthetic-watermark';
    e.textContent = 'T11 합성 데이터 · 로컬 통합 검증';
    Object.assign(e.style, {
      position: 'fixed',
      bottom: '0',
      right: '0',
      zIndex: '2147483647',
      fontSize: '11px',
      background: '#fff',
      color: '#333',
      padding: '4px'
    });
    document.body.append(e);
  });
  try {
    await page.screenshot({
      path: path.join(evidence, `${name}.png`),
      fullPage: true,
      style: 'output {visibility:hidden !important}'
    });
  } finally {
    await page.locator('#t11-synthetic-watermark').evaluate(e => e.remove()).catch(() => {});
  }
}
const command = revision => ({
  operation_key: crypto.randomUUID(),
  expected_revision: revision
});

async function activeLayout(hostActor, memberActor) {
  let classId, regular, makeupId;
  await step('V30 active 전용 실제 클래스·결석·빈 보강 회차 준비', async () => {
    const schedule = { title: 'T11 합성 참여 중 4뷰포트', linkband_mode: 'none', record_audio: false,
      record_video: false, capacity: 8, planned_session_count: 2, duration_min: 30, reminder_offsets: [],
      recurrence_rule: {version: 1, start_date: scheduleStart, weekdays: [1], time: '19:00'},
      assignment_rule: {version: 1, mode: 'all_one', host_ids: [seed.host.id]},
      instructors: [{user_id: seed.host.id, role: 'lead'}] };
    const made = ok(await req(hostActor, 'POST', '/classes', {operation_key: crypto.randomUUID(), schedule}), 201);
    classId = made.class_id;
    regular = ok(await req(hostActor, 'GET', `/classes/${classId}/sessions`)).sessions;
    let detail = ok(await req(hostActor, 'GET', `/classes/${classId}`));
    ok(await req(hostActor, 'POST', `/classes/${classId}/members`, {...command(detail.revision), user_ids: [seed.absent.id]}));
    for (const action of ['open','start','end']) ok(await req(hostActor, 'POST', `/sessions/${regular[0].id}/${action}`));
    fixture('past', regular[0].id);
    detail = ok(await req(hostActor, 'GET', `/classes/${classId}`));
    const targetDate = new Date(regular[1].scheduled_at); targetDate.setUTCDate(targetDate.getUTCDate()+2);
    const extra = ok(await req(hostActor, 'POST', `/classes/${classId}/sessions`, {...command(detail.revision),
      row: {client_key: crypto.randomUUID(), seq: 3, scheduled_at: targetDate.toISOString(), duration_min: 30,
        host_id: seed.host.id, session_kind: 'makeup'}, makeup_for_session_id: regular[0].id}), 201);
    makeupId = extra.session_ids[0];
    const own = ok(await req(memberActor, 'GET', `/classes/${classId}/me/membership`));
    assert.equal(own.member.status, 'active');
    assert(own.capabilities.excuse && own.capabilities.request_makeup && own.capabilities.edit_consents);
    return {class_id: classId, class_status: detail.status, member_status: own.member.status,
      source_session: regular[0].id, future_session: regular[1].id, makeup_session: makeupId};
  });
  const p = memberActor.page, findings = [];
  const sizes = [[390,844],[834,1194],[1194,834],[1280,720]];
  const panel = () => p.getByRole('region', {name: '내 클래스 참여 관리'});
  async function openOwn() {
    await p.goto(`${BASE}/app/classes/${classId}`);
    await panel().waitFor();
    await panel().getByText('참여 중', {exact: true}).waitFor();
  }
  async function capture(section,width,height,target) {
    await target.scrollIntoViewIfNeeded();
    await snapshot(p, `T11-active-${section}-${width}x${height}`);
    const bounds = await p.evaluate(() => ({viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      clipped: [...document.querySelectorAll('main button,main input,main select,main h1,main h2,main .mc-chip')]
        .filter(e => {const r=e.getBoundingClientRect(),s=getComputedStyle(e);
          return r.width>0 && s.visibility!=='hidden' && (r.left < -1 || r.right>innerWidth+1);})
        .map(e=>({tag:e.tagName,text:e.tagName==='INPUT'?'[입력]':e.textContent.slice(0,70)}))}));
    assert.equal(bounds.scroll,bounds.viewport,'active 가로 넘침');
    assert.equal(bounds.clipped.length,0,'active 본문 가로 클리핑');
    findings.push({section,width,height,...bounds});
  }
  await step('V30 active 4뷰포트 사전 결석·보강 신청·동의 활성 조작 영역', async () => {
    for (const [width,height] of sizes) {
      await p.setViewportSize({width,height}); await openOwn();
      await capture('top',width,height,panel().getByRole('heading',{name:'내 참여 정보',exact:true}));
      const excuse=panel().getByRole('button',{name:'사전 결석',exact:true});
      assert(await excuse.isEnabled());
      await capture('attendance',width,height,excuse);
      await p.getByLabel('보강 원회차',{exact:true}).selectOption(regular[0].id);
      await p.getByLabel('보강 대상 회차',{exact:true}).selectOption(makeupId);
      const reserve=panel().getByRole('button',{name:'보강 예약하기',exact:true});
      assert(await reserve.isEnabled());
      await capture('makeup',width,height,reserve);
      const consent=panel().getByLabel('[선택] 개인 리포트 반영',{exact:true});
      const research=panel().getByLabel('[선택] 연구 목적 활용 동의',{exact:true});
      assert(await consent.isEnabled());assert(await research.isEnabled());
      await consent.check();await research.check();
      const save=panel().getByRole('button',{name:'동의 설정 저장',exact:true});
      assert(await save.isEnabled());
      await capture('consents',width,height,save);
    }
    return {viewports:4,sections_per_viewport:4,screenshots:16,enabled_controls:['사전 결석','보강 예약하기','동의 설정 저장']};
  });
  await step('V30 active 표시한 동의·사전 결석/복귀·보강 실제 저장', async () => {
    let response=p.waitForResponse(r=>r.url().endsWith('/me/consents')&&r.request().method()==='PUT');
    await panel().getByRole('button',{name:'동의 설정 저장',exact:true}).click();assert.equal((await response).status(),200);
    await openOwn();
    const consents=ok(await req(memberActor,'GET',`/classes/${classId}/me/consents`));
    assert(consents.report_included_default&&consents.research_consented);
    response=p.waitForResponse(r=>r.url().endsWith('/attendance')&&r.request().method()==='POST');
    await panel().getByRole('button',{name:'사전 결석',exact:true}).click();assert.equal((await response).status(),200);
    await openOwn();
    response=p.waitForResponse(r=>r.url().endsWith('/attendance')&&r.request().method()==='POST');
    await panel().getByRole('button',{name:'사전 결석 취소',exact:true}).click();assert.equal((await response).status(),200);
    await openOwn();
    await p.getByLabel('보강 원회차',{exact:true}).selectOption(regular[0].id);
    await p.getByLabel('보강 대상 회차',{exact:true}).selectOption(makeupId);
    response=p.waitForResponse(r=>r.url().endsWith('/makeup-assignments')&&r.request().method()==='POST');
    await panel().getByRole('button',{name:'보강 예약하기',exact:true}).click();assert.equal((await response).status(),201);
    const own=ok(await req(memberActor,'GET',`/classes/${classId}/me/membership`));
    assert.equal(own.member.status,'active');assert.equal(own.attendance_summary.makeup_reserved,1);
    return {consents:200,excuse:200,undo_excuse:200,makeup:201,member_status:own.member.status};
  });
  await step('V30 active 보강 예약 배지·취소 버튼 4뷰포트', async () => {
    for (const [width,height] of sizes) {
      await p.setViewportSize({width,height});await openOwn();
      const cancel=panel().getByRole('button',{name:'보강 예약 취소',exact:true});assert(await cancel.isEnabled());
      await capture('makeup-reserved',width,height,cancel);
    }
    writeFileSync(path.join(evidence,'T11-active-layout.json'),JSON.stringify({synthetic:true,class_id:classId,member_status:'active',findings},null,2));
    return {viewports:4,screenshots:4,member_status:'active',reservation:'reserved',cancel_enabled:true};
  });
}

let host, member, late, absent, cid, sessions, reportId, ga, gb, guestReport;
try {
  host = await step('실제 UI 로그인 합성 강사', () => actor('host'));
  member = await step('실제 UI 로그인 합성 회원', () => actor('member'));
  late = await step('실제 UI 로그인 합성 중간합류', () => actor('late'));
  absent = await step('실제 UI 로그인 합성 미입장', () => actor('absent'));
  if (activeOnly) {
    await activeLayout(host, absent);
  } else if (!layoutOnly) {
    let instant;
    await step('UI 바로 지금 클래스 생성', async () => {
      const p = host.page;
      await p.goto(BASE + '/classes/new');
      await p.getByRole('button', {
        name: /처음부터 만들어요/
      }).click();
      await p.getByLabel('클래스 이름', {
        exact: true
      }).fill('T11 합성 즉시 완료 검증');
      await p.getByRole('button', {
        name: '다음',
        exact: true
      }).click();
      await p.getByRole('button', {
        name: '바로 지금',
        exact: true
      }).click();
      await p.getByRole('button', {
        name: '바로 지금',
        exact: true
      }).getAttribute('aria-pressed').then(v => assert.equal(v, 'true'));
      await p.getByRole('button', {
        name: '다음',
        exact: true
      }).click();
      await p.getByRole('tablist', {
        name: '초대 방법'
      }).waitFor();
      const response = p.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/classes' && r.request().method() === 'POST');
      await p.getByRole('button', {
        name: '클래스 만들기',
        exact: true
      }).click();
      const r = await response;
      assert.equal(r.status(), 201);
      instant = await r.json();
      await p.getByRole('link', {
        name: '진행 화면으로 이동'
      }).waitFor();
      await snapshot(p, 'T11-create-success');
      return {
        class_id: instant.class_id,
        session_ids: instant.session_ids
      };
    });
    await step('즉시 회차 종료와 열려 있던 상세 완료 재조회 NV10', async () => {
      const id = instant.session_ids[0];
      await host.page.goto(BASE + '/classes/' + instant.class_id);
      await host.page.getByText('T11 합성 즉시 완료 검증', {
        exact: true
      }).first().waitFor();
      ok(await req(host, 'POST', `/sessions/${id}/start`));
      ok(await req(host, 'POST', `/sessions/${id}/end`));
      await host.page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await host.page.getByText('완료', {
        exact: true
      }).first().waitFor();
      const d = ok(await req(host, 'GET', '/classes/' + instant.class_id));
      assert.equal(d.status, 'completed');
      await snapshot(host.page, 'T11-instant-completed');
      return {
        class_status: d.status,
        cron_used: false
      };
    });
    await step('실제 API 3회 클래스 생성 밴드 없음', async () => {
      const schedule = {
        title: 'T11 합성 전체 멤버십 여정',
        linkband_mode: 'none',
        record_audio: false,
        record_video: false,
        capacity: 10,
        planned_session_count: 3,
        duration_min: 30,
        reminder_offsets: [],
        recurrence_rule: {
          version: 1,
          start_date: scheduleStart,
          weekdays: [1],
          time: '19:00'
        },
        assignment_rule: {
          version: 1,
          mode: 'all_one',
          host_ids: [seed.host.id]
        },
        instructors: [{
          user_id: seed.host.id,
          role: 'lead'
        }]
      };
      const made = ok(await req(host, 'POST', '/classes', {
        operation_key: crypto.randomUUID(),
        schedule
      }), 201);
      cid = made.class_id;
      sessions = ok(await req(host, 'GET', `/classes/${cid}/sessions`)).sessions;
      return {
        class_id: cid,
        session_ids: sessions.map(x => x.id)
      };
    });
    await step('UI 호스트 회원 초대 실제 반영', async () => {
      const p = host.page;
      await p.goto(`${BASE}/classes/${cid}?tab=members`);
      await p.getByRole('button', {
        name: '회원 초대',
        exact: true
      }).click();
      await p.getByRole('searchbox').fill(seed.member.email);
      await p.getByLabel('합성 회원 선택', {
        exact: true
      }).check();
      const response = p.waitForResponse(r => r.url().endsWith(`/classes/${cid}/members`) && r.request().method() === 'POST');
      await p.getByRole('button', {
        name: '선택 회원 초대',
        exact: true
      }).click();
      assert.equal((await response).status(), 200);
      let d = ok(await req(host, 'GET', `/classes/${cid}`));
      ok(await req(host, 'POST', `/classes/${cid}/members`, {
        ...command(d.revision),
        user_ids: [seed.absent.id]
      }));
      return {
        invited: 2
      };
    });
    let code = ok(await req(host, 'GET', `/classes/${cid}`)).host_view.access_code;
    await step('체크인 미작성·초대만으로 현재 참여 아님 NV04/NV07', async () => {
      ok(await req(host, 'POST', `/sessions/${sessions[0].id}/open`));
      let snap = ok(await req(host, 'GET', `/classes/${cid}/sessions/${sessions[0].id}/participation`));
      assert.equal(snap.participants.length, 2);
      assert(snap.participants.every(p => !p.entered_at && p.presence_state !== 'connected' && p.checkin_state !== 'completed'));
      await host.page.goto(`${BASE}/sessions/${sessions[0].id}/player`);
      await host.page.getByText('2명이 아직 입장하지 않았어요', {
        exact: true
      }).waitFor();
      await snapshot(host.page, 'T11-host-before-checkin');
      ok(await req(host, 'POST', `/sessions/${sessions[0].id}/start`));
      return {
        states: snap.participants.map(p => ({
          checkin: p.checkin_state,
          presence: p.presence_state,
          attendance: p.attendance_status
        }))
      };
    });
    await step('밴드 없이 서버 체크인·실제 입장·현재 접속 WS NV04/NV05', async () => {
      const sid = sessions[0].id;
      ok(await req(member, 'POST', `/sessions/${sid}/checkin`, {
        phase: 'before',
        arousal: 3,
        valence: 4
      }));
      const entered = ok(await req(member, 'POST', `/sessions/${sid}/enter`));
      assert(entered.entry_credential);
      await member.page.evaluate(async ({
        sid,
        pid,
        token,
        entry
      }) => {
        const {
          io
        } = await import('/node_modules/.vite/deps/socket__io-client.js');
        window.t11Socket = io('http://127.0.0.1:55439/session-live', {
          transports: ['websocket'],
          auth: {
            token
          }
        });
        window.t11Events = [];
        window.t11Socket.onAny((name, data) => window.t11Events.push({
          name,
          data
        }));
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('실제 WS join timeout')), 9000);
          window.t11Socket.once('joined', () => {
            clearTimeout(timeout);
            resolve();
          });
          window.t11Socket.once('connect_error', () => reject(new Error('실제 WS connect error')));
          window.t11Socket.emit('join', {
            session_id: sid,
            participant_id: pid,
            entry_credential: entry
          });
        });
      }, {
        sid,
        pid: entered.participant_id,
        token: member.token,
        entry: entered.entry_credential
      });
      let snap = ok(await req(host, 'GET', `/classes/${cid}/sessions/${sid}/participation`));
      let mine = snap.participants.find(p => p.participant_id === entered.participant_id);
      assert.equal(mine.checkin_state, 'completed');
      assert.equal(mine.presence_state, 'connected');
      assert.equal(mine.attendance_status, 'attended');
      return {
        participation_version: snap.participation_version,
        checkin: mine.checkin_state,
        presence: mine.presence_state,
        attendance: mine.attendance_status
      };
    });
    await step('호스트 새로고침·실제 WS 퇴장 재접속 NV06/NV08', async () => {
      const sid = sessions[0].id;
      await host.page.reload();
      await host.page.getByRole('button', {
        name: /합성 회원.*체크인 완료.*참여 중/
      }).first().waitFor();
      assert.match(await host.page.locator('[data-pz=ttl]').innerText(), /접속\s*1\/2/);
      await host.page.getByRole('button', {
        name: '체크인 1/2',
        exact: true
      }).waitFor();
      assert.match(await host.page.getByRole('group', {
        name: '밴드 상태 요약'
      }).innerText(), /밴드 연결\s*0/);
      await snapshot(host.page, 'T11-host-restored');
      await member.page.evaluate(() => window.t11Socket.disconnect());
      await new Promise(r => setTimeout(r, 350));
      let snap = ok(await req(host, 'GET', `/classes/${cid}/sessions/${sid}/participation`));
      let p = snap.participants.find(p => p.checkin_state === 'completed');
      assert.equal(p.presence_state, 'disconnected');
      assert.equal(p.attendance_status, 'attended');
      const before = snap.participation_version;
      await member.page.evaluate(async sid => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('재연결 timeout')), 9000);
          window.t11Socket.once('joined', () => {
            clearTimeout(timer);
            resolve();
          });
          window.t11Socket.once('connect', () => window.t11Socket.emit('join', {
            session_id: sid
          }));
          window.t11Socket.connect();
        });
      }, sid);
      snap = ok(await req(host, 'GET', `/classes/${cid}/sessions/${sid}/participation`));
      p = snap.participants.find(p => p.checkin_state === 'completed');
      assert.equal(p.presence_state, 'connected');
      assert(snap.participation_version > before);
      return {
        before,
        after: snap.participation_version,
        checkin: p.checkin_state
      };
    });
    await step('정상 종료 미입장 결석·중간합류 과거 미생성', async () => {
      await member.page.evaluate(() => window.t11Socket.disconnect());
      ok(await req(host, 'POST', `/sessions/${sessions[0].id}/end`));
      fixture('past', sessions[0].id);
      await late.page.goto(BASE + '/app/classes');
      await late.page.getByLabel('회원 클래스 코드').fill(code);
      await late.page.getByRole('button', {
        name: '클래스 코드 확인',
        exact: true
      }).click();
      await late.page.getByRole('button', {
        name: '코드로 가입',
        exact: true
      }).click();
      await late.page.getByRole('region', {
        name: '내 클래스 참여 관리'
      }).waitFor();
      let a = ok(await req(absent, 'GET', `/classes/${cid}/me/attendance`)).sessions;
      assert.equal(a[0].attendance.attendance_status, 'absent');
      a = ok(await req(late, 'GET', `/classes/${cid}/me/attendance`)).sessions;
      assert.equal(a[0].participation_scope, 'before_join');
      assert.equal(a[0].attendance, null);
      return {
        absent: 'absent',
        late_scope: a[0].participation_scope
      };
    });
    let makeupSid;
    await step('UI 사전 결석·복귀·선택 동의 저장 실제 반영', async () => {
      const p = absent.page;
      await p.goto(`${BASE}/app/classes/${cid}`);
      const panel = p.getByRole('region', {
        name: '내 클래스 참여 관리'
      });
      await panel.waitFor();
      await panel.getByRole('button', {
        name: '사전 결석',
        exact: true
      }).first().click();
      await panel.getByRole('button', {
        name: '사전 결석 취소',
        exact: true
      }).waitFor();
      await panel.getByRole('button', {
        name: '사전 결석 취소',
        exact: true
      }).click();
      await panel.getByRole('button', {
        name: '사전 결석',
        exact: true
      }).first().waitFor();
      await panel.getByLabel('[선택] 개인 리포트 반영', {
        exact: true
      }).check();
      await panel.getByLabel('[선택] 연구 목적 활용 동의', {
        exact: true
      }).check();
      const response = p.waitForResponse(r => r.url().endsWith('/me/consents') && r.request().method() === 'PUT');
      await panel.getByRole('button', {
        name: '동의 설정 저장'
      }).click();
      const consentResponse = await response;
      assert.equal(consentResponse.status(), 200);
      const sent = consentResponse.request().postDataJSON();
      console.log('동의 요청 선택 필드 ' + JSON.stringify({
        report: sent.report_included_default,
        research: sent.research_consented
      }));
      const data = ok(await req(absent, 'GET', `/classes/${cid}/me/consents`));
      console.log('동의 저장 실제 값 ' + JSON.stringify({
        report: data.report_included_default,
        research: data.research_consented
      }));
      assert(data.report_included_default && data.research_consented);
      return {
        report: data.report_included_default,
        research: data.research_consented
      };
    });
    await step('개인 보강 회차 생성과 UI 예약', async () => {
      let d = ok(await req(host, 'GET', `/classes/${cid}`));
      const date = new Date(sessions[2].scheduled_at);
      date.setUTCDate(date.getUTCDate() + 2);
      const made = ok(await req(host, 'POST', `/classes/${cid}/sessions`, {
        ...command(d.revision),
        row: {
          client_key: crypto.randomUUID(),
          seq: 4,
          scheduled_at: date.toISOString(),
          duration_min: 30,
          host_id: seed.host.id,
          session_kind: 'makeup'
        },
        makeup_for_session_id: sessions[0].id
      }), 201);
      makeupSid = made.session_ids?.[0] ?? ok(await req(host, 'GET', `/classes/${cid}/sessions`)).sessions.find(s => s.session_kind === 'makeup').id;
      const p = absent.page;
      await p.reload();
      await p.getByLabel('보강 원회차', {
        exact: true
      }).selectOption(sessions[0].id);
      await p.getByLabel('보강 대상 회차', {
        exact: true
      }).selectOption(makeupSid);
      const response = p.waitForResponse(r => r.url().endsWith('/makeup-assignments') && r.request().method() === 'POST');
      await p.getByRole('button', {
        name: '보강 예약하기',
        exact: true
      }).click();
      assert.equal((await response).status(), 201);
      const rows = ok(await req(absent, 'GET', `/classes/${cid}/me/attendance`)).sessions;
      assert.equal(rows.find(s => s.id === sessions[0].id).attendance.attendance_status, 'absent');
      assert.equal(rows.find(s => s.id === makeupSid).makeup.status, 'reserved');
      return {
        session_id: makeupSid,
        reserved: true,
        source: 'absent'
      };
    });
    await step('보강 실제 입장·종료·이탈 후 UI 승인 과거 리포트', async () => {
      ok(await req(host, 'POST', `/sessions/${makeupSid}/open`));
      ok(await req(absent, 'POST', `/sessions/${makeupSid}/enter`));
      ok(await req(host, 'POST', `/sessions/${makeupSid}/start`));
      ok(await req(host, 'POST', `/sessions/${makeupSid}/end`));
      const created = JSON.parse(fixture('report', cid, makeupSid, seed.absent.id));
      reportId = created.report_id;
      const p = absent.page;
      await p.reload();
      await p.getByRole('button', {
        name: '클래스 나가기',
        exact: true
      }).click();
      await p.getByRole('button', {
        name: '재가입',
        exact: true
      }).waitFor();
      await p.getByRole('button', {
        name: '승인 리포트 보기',
        exact: true
      }).click();
      await p.getByRole('region', {
        name: '승인된 본인 리포트'
      }).waitFor();
      const own = ok(await req(absent, 'GET', `/classes/${cid}/me/membership`));
      assert.equal(own.member.status, 'left');
      assert.equal(own.attendance_summary.makeup_completed, 1);
      ok(await req(absent, 'GET', `/reports/${reportId}`));
      assert.equal((await req(late, 'GET', `/reports/${reportId}`)).status, 404);
      await snapshot(p, 'T11-left-approved-report');
      return {
        membership: 'left',
        makeup_completed: 1,
        own_report: 200,
        other_report: 404,
        report_origin: '합성 승인 리포트 fixture (AI 생성/승인 UI 아님)'
      };
    });
    await step('UI 호스트 출석 정정·참여 해제·복구 실제 반영', async () => {
      const p = host.page;
      await p.goto(`${BASE}/classes/${cid}?tab=members`);
      let members = ok(await req(host, 'GET', `/classes/${cid}/members`)).members;
      const target = members.find(m => m.user_id === seed.member.id);
      await p.getByLabel('멤버 운영 사유', {
        exact: true
      }).fill('T11 합성 본인 확인 및 출석 증빙 검증');
      await p.getByLabel('운영 대상 멤버', {
        exact: true
      }).selectOption(target.id);
      await p.getByLabel('출석 정정 회차', {
        exact: true
      }).selectOption(sessions[0].id);
      await p.getByLabel('정정할 출석', {
        exact: true
      }).selectOption('correct_excused');
      let response = p.waitForResponse(r => r.url().endsWith('/attendance') && r.request().method() === 'POST');
      await p.getByRole('button', {
        name: '출석 정정 저장',
        exact: true
      }).click();
      assert.equal((await response).status(), 200);
      await p.getByRole('button', {
        name: '참여 해제',
        exact: true
      }).click();
      await p.getByRole('button', {
        name: '멤버 복구',
        exact: true
      }).waitFor();
      await p.getByRole('button', {
        name: '멤버 복구',
        exact: true
      }).click();
      await p.getByRole('button', {
        name: '참여 해제',
        exact: true
      }).waitFor();
      members = ok(await req(host, 'GET', `/classes/${cid}/members`)).members;
      assert.equal(members.find(m => m.id === target.id).status, 'active');
      const rows = ok(await req(member, 'GET', `/classes/${cid}/me/attendance`)).sessions;
      assert.equal(rows.find(s => s.id === sessions[0].id).attendance.attendance_status, 'excused');
      return {
        restored: 'active',
        corrected: 'excused'
      };
    });
    const guestActors = [];
    async function guestJoin(name, research) {
      const context = await browser.newContext({
        viewport: {
          width: 1280,
          height: 720
        }
      });
      contexts.push(context);
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const a = {
        page,
        context,
        token: null
      };
      page.on('response', r => {
        if (r.url().startsWith(API) || r.url().startsWith(BASE + '/api/')) requests.push({
          method: r.request().method(),
          path: new URL(r.url()).pathname,
          status: r.status()
        });
      });
      page.on('requestfailed', r => errors.push({
        type: 'requestfailed',
        path: new URL(r.url()).pathname,
        error: safe(r.failure()?.errorText)
      }));
      page.on('console', m => {
        if (m.type() === 'error') errors.push({
          type: 'console',
          error: safe(m.text())
        });
      });
      page.on('pageerror', e => errors.push({
        type: 'pageerror',
        error: safe(e.message)
      }));
      await page.goto(`${BASE}/class-members/${cid}`);
      await page.getByLabel('클래스 코드', {
        exact: true
      }).fill(code);
      await page.getByLabel('이름', {
        exact: true
      }).fill(name);
      await page.getByLabel('성별', {
        exact: true
      }).selectOption('other');
      await page.getByLabel('생년월일', {
        exact: true
      }).fill('2000-01-01');
      await page.getByLabel('이메일', {
        exact: true
      }).fill('t11-guest@example.com');
      assert.equal(await page.getByLabel('[선택] 개인 리포트 반영', {
        exact: true
      }).isChecked(), false);
      assert.equal(await page.getByLabel('[선택] 연구 목적 활용 동의', {
        exact: true
      }).isChecked(), false);
      assert.equal(await page.getByLabel('[선택] 알림 수신', {
        exact: true
      }).isChecked(), false);
      if (research) await page.getByLabel('[선택] 연구 목적 활용 동의', {
        exact: true
      }).check();
      const response = page.waitForResponse(r => r.url().endsWith('/guest-memberships') && r.request().method() === 'POST');
      await page.getByRole('button', {
        name: '비회원 가입',
        exact: true
      }).click();
      const r = await response;
      assert.equal(r.status(), 201);
      a.join = await r.json();
      await page.getByRole('region', {
        name: '내 클래스 참여 관리'
      }).waitFor();
      guestActors.push(a);
      return a;
    }
    await step('공개 UI 비회원 두 명 가입·O3 가입 선택 복사', async () => {
      ga = await guestJoin('T11 합성 비회원 원본', true);
      gb = await guestJoin('T11 합성 비회원 대상', false);
      assert.notEqual(ga.join.member.id, gb.join.member.id);
      const inspect = JSON.parse(fixture('inspect', cid));
      const m = inspect.members.find(m => m.id === ga.join.member.id);
      assert(m.research && m.research_origin);
      const ps = inspect.participants.filter(p => p.member_id === m.id);
      assert(ps.length >= 2 && ps.every(p => p.research_origin === m.research_origin));
      return {
        distinct_members: true,
        research_origin_copied: ps.length,
        report_default: false,
        reminder_default: false
      };
    });
    await step('비회원 장기 활동 자격 교환·실제 회차 입장·본인 기록', async () => {
      const sid = sessions[1].id;
      ok(await req(host, 'POST', `/sessions/${sid}/open`));
      const a = ga;
      await a.page.getByRole('button', {
        name: '최신 내용 다시 불러오기',
        exact: true
      }).click();
      await a.page.getByRole('button', {
        name: '회차 입장',
        exact: true
      }).waitFor();
      const response = a.page.waitForResponse(r => r.url().endsWith('/guest-entry') && r.request().method() === 'POST');
      await a.page.getByRole('button', {
        name: '회차 입장',
        exact: true
      }).click();
      assert.equal((await response).status(), 200);
      await a.page.waitForURL(url => url.pathname.includes('/class/'));
      ok(await req(host, 'POST', `/sessions/${sid}/start`));
      ok(await req(host, 'POST', `/sessions/${sid}/end`));
      guestReport = JSON.parse(fixture('guest-report', cid, sid, ga.join.member.id)).report_id;
      return {
        activity_to_entry: 200,
        entry_ui: true,
        approved_report_fixture: true
      };
    });
    await step('UI 병합·양쪽 옛 자격 회수·강사 단회 복구', async () => {
      const p = host.page;
      await p.goto(`${BASE}/classes/${cid}?tab=members`);
      await p.getByLabel('멤버 운영 사유', {
        exact: true
      }).fill('T11 합성 같은 본인 대면 확인');
      await p.getByLabel('병합 원본 비회원', {
        exact: true
      }).selectOption(ga.join.member.id);
      await p.getByLabel('병합 대상 비회원', {
        exact: true
      }).selectOption(gb.join.member.id);
      await p.getByRole('button', {
        name: '병합 미리보기',
        exact: true
      }).click();
      await p.getByText(/충돌 0건/).waitFor();
      await p.getByLabel('두 비회원이 같은 본인임을 직접 확인했어요', {
        exact: true
      }).check();
      let response = p.waitForResponse(r => r.url().endsWith('/guest-merges') && r.request().method() === 'POST');
      await p.getByRole('button', {
        name: '확인한 비회원 병합',
        exact: true
      }).click();
      assert.equal((await response).status(), 200);
      for (const a of [ga, gb]) for (const token of [a.join.credential_bundle.activity_credential, a.join.credential_bundle.read_credential]) assert.equal((await req(a, 'GET', `/classes/${cid}/me/membership`, null, token)).status, 401);
      await p.getByLabel('운영 대상 멤버', {
        exact: true
      }).selectOption(gb.join.member.id);
      await p.getByRole('button', {
        name: '본인 확인 완료 · 단회 복구 발급',
        exact: true
      }).click();
      const out = p.locator('output').filter({
        hasText: /^[A-Za-z0-9_-]{32,}$/
      });
      await out.waitFor();
      const token = await out.innerText();
      assert(token.length >= 32);
      await p.getByRole('button', {
        name: '복구 코드 숨기기',
        exact: true
      }).click();
      await gb.page.reload();
      await gb.page.getByLabel('단회 복구 코드', {
        exact: true
      }).fill(token);
      response = gb.page.waitForResponse(r => r.url().endsWith('/guest-credentials/exchange'));
      await gb.page.getByRole('button', {
        name: '자격 복구하기',
        exact: true
      }).click();
      const r = await response;
      assert.equal(r.status(), 200);
      gb.recovered = await r.json();
      await gb.page.getByRole('region', {
        name: '내 클래스 참여 관리'
      }).waitFor();
      assert.equal((await req(ga, 'POST', `/classes/${cid}/guest-credentials/exchange`, {
        exchange_token: token
      })).status, 401);
      return {
        old_grants_rejected: 4,
        recovered: true,
        single_use_reuse: 401,
        token_logged: false
      };
    });
    await step('병합 비회원 이탈 후 본인 과거 읽기·로그아웃 회수 V38', async () => {
      const p = gb.page;
      let response = p.waitForResponse(r => r.url().endsWith('/transition') && r.request().method() === 'POST');
      await p.getByRole('button', {
        name: '클래스 나가기',
        exact: true
      }).click();
      const r = await response;
      assert.equal(r.status(), 200);
      const left = await r.json();
      gb.left = left;
      await p.getByRole('button', {
        name: '승인 리포트 보기',
        exact: true
      }).click();
      await p.getByRole('region', {
        name: '승인된 본인 리포트'
      }).waitFor();
      const data = ok(await req(gb, 'GET', `/classes/${cid}/me/membership`, null, left.credential_bundle.read_credential));
      assert.equal(data.member.status, 'left');
      assert(!data.capabilities.leave && !data.capabilities.edit_consents);
      ok(await req(gb, 'GET', `/reports/${guestReport}`, null, left.credential_bundle.read_credential));
      await snapshot(p, 'T11-guest-left-read');
      await p.getByRole('button', {
        name: '비회원 로그아웃',
        exact: true
      }).click();
      await p.getByText('로그아웃했어요. 모든 이전 비회원 자격이 회수됐어요.', {
        exact: true
      }).waitFor();
      assert.equal((await req(gb, 'GET', `/reports/${guestReport}`, null, left.credential_bundle.read_credential)).status, 404);
      return {
        left_read: 200,
        write_capabilities: false,
        logout_old_read: 404
      };
    });
    await step('완료 멤버·취소 회차 상태 UI 준비 및 실제 최종 정규 종료', async () => {
      let d = ok(await req(host, 'GET', `/classes/${cid}`));
      const date = new Date(sessions[2].scheduled_at);
      date.setUTCDate(date.getUTCDate() + 4);
      const made = ok(await req(host, 'POST', `/classes/${cid}/sessions`, {
        ...command(d.revision),
        row: {
          client_key: crypto.randomUUID(),
          seq: 5,
          scheduled_at: date.toISOString(),
          duration_min: 30,
          host_id: seed.host.id,
          session_kind: 'makeup'
        },
        makeup_for_session_id: sessions[0].id
      }), 201);
      ok(await req(host, 'POST', `/sessions/${made.session_ids[0]}/cancel`));
      const sid = sessions[2].id;
      ok(await req(host, 'POST', `/sessions/${sid}/open`));
      ok(await req(host, 'POST', `/sessions/${sid}/start`));
      ok(await req(host, 'POST', `/sessions/${sid}/end`));
      d = ok(await req(host, 'GET', `/classes/${cid}`));
      assert.equal(d.status, 'completed');
      const m = ok(await req(late, 'GET', `/classes/${cid}/me/membership`));
      assert.equal(m.member.status, 'completed');
      return {
        class_status: d.status,
        membership: m.member.status,
        cancelled_makeup: true
      };
    });
  } else {
    cid = prior.results.find(x => x.name === '실제 API 3회 클래스 생성 밴드 없음').detail.class_id;
    const context = await browser.newContext();
    contexts.push(context);
    gb = {
      page: await context.newPage(),
      context,
      token: null
    };
  }
  if (!activeOnly) {
  await step('4뷰포트 실제 화면과 넘침·클리핑 수치 V30', async () => {
    const findings = [];
    for (const [width, height] of [[390, 844], [834, 1194], [1194, 834], [1280, 720]]) {
      for (const [name, a, route] of [['member-left', absent, `/app/classes/${cid}`], ['member-completed-before', late, `/app/classes/${cid}`], ['host-members', host, `/classes/${cid}?tab=members`], ['guest-public', gb, `/class-members/${cid}`]]) {
        await a.page.setViewportSize({
          width,
          height
        });
        await a.page.goto(BASE + route);
        await a.page.getByText(name === 'guest-public' ? '비회원 클래스 참여' : name === 'host-members' ? '멤버 운영' : '내 참여 정보', {
          exact: true
        }).first().waitFor();
        await snapshot(a.page, `T11-${name}-${width}x${height}`);
        if (name.startsWith('member-')) {
          await a.page.getByRole('region', {
            name: '내 클래스 참여 관리'
          }).locator('li').last().scrollIntoViewIfNeeded();
          await snapshot(a.page, `T11-${name}-lower-${width}x${height}`);
        } else if (name === 'host-members') {
          await a.page.getByRole('button', {
            name: '최신 내용 다시 불러오기',
            exact: true
          }).scrollIntoViewIfNeeded();
          await snapshot(a.page, `T11-${name}-lower-${width}x${height}`);
        }
        const bounds = await a.page.evaluate(() => ({
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
          clipped: [...document.querySelectorAll('main button,main input,main select,main h1,main h2,main .mc-chip')].filter(e => {
            const r = e.getBoundingClientRect(),
              s = getComputedStyle(e);
            return r.width > 0 && s.visibility !== 'hidden' && (r.left < -1 || r.right > innerWidth + 1);
          }).map(e => ({
            tag: e.tagName,
            text: e.tagName === 'INPUT' ? '[입력]' : e.textContent.slice(0, 70)
          })).slice(0, 10)
        }));
        assert.equal(bounds.scroll, bounds.viewport, '가로 스크롤 발생');
        assert.equal(bounds.clipped.length, 0, '본문 가로 클리핑 발생');
        findings.push({
          name,
          width,
          height,
          ...bounds
        });
      }
    }
    writeFileSync(path.join(evidence, 'T11-layout.json'), JSON.stringify(findings, null, 2));
    return findings;
  });
  await step('실카메라 사용 가능성 조사 촬영 없음 NV03', async () => {
    const p = host.page;
    const devices = await p.evaluate(async () => ({
      secure: isSecureContext,
      mediaDevices: !!navigator.mediaDevices,
      devices: (await navigator.mediaDevices.enumerateDevices()).map(x => ({
        kind: x.kind,
        labelAvailable: !!x.label
      }))
    }));
    return {
      ...devices,
      real_capture_requested: false,
      fake_camera_used: false,
      status: '실카메라 프레임 미측정'
    };
  });
  }
} catch (e) {
  console.error(safe(e.message));
  for (let i = 0; i < contexts.length; i++) {
    const p = contexts[i].pages()[0];
    if (p) {
      await snapshot(p, `T11-failure-${i}`).catch(() => {});
      console.error(`화면${i}: ` + safe((await p.locator('body').innerText()).slice(-2300)));
    }
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  console.log('T11 시나리오 ' + JSON.stringify({
    passed: results.filter(x => x.status === 'PASS').length,
    failed: results.filter(x => x.status === 'FAIL').length
  }));
}
