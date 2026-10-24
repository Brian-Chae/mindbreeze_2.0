const fs = require('node:fs');
// 실제 Chromium IndexedDB로 재로드·보존·소유자 격리를 검증한다. 외부 요청은 모두 가로챈다.
const path = require('node:path');
const root = path.resolve(__dirname, '../../frontend');
const ts = require(root + '/node_modules/typescript');
const { chromium } = require(root + '/node_modules/playwright');
(async () => {
  const source = fs.readFileSync(root + '/src/lib/session-live/raw-chunk-queue.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'eeg-raw-idb-'));
  const launch = () => chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome'});
  let browser = await launch();
  try {
    let page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>EEG queue verification</title>'}));
    await page.goto('https://eeg-queue.test/');
    const install = () => page.addScriptTag({content: 'var exports = {};\n' + code + '\nwindow.rawQueue = exports;'});
    await install();
    const first = await page.evaluate(async () => {
      const q = window.rawQueue;
      const item = { sessionId:'session-a', participantId:'participant-a', ownerId:'owner-a', streamId:'raw-browser', chunkIndex:0,
        startedAt:'', endedAt:'', sampleRate:250, channels:['fp1','fp2'], unit:'uV', schemaVersion:'v1', checksum:'test-sum', byteSize:4,
        contentType:'application/octet-stream', payload:new Uint8Array([1,2,3,4]).buffer };
      await q.enqueueRawChunk(item);
      for(let i=0; i<8; i++) await q.markRawChunkAttempt(item.streamId,0,'permission denied',true);
      let collisionRejected = false;
      try { await q.enqueueRawChunk({...item,checksum:'other'}); } catch { collisionRejected = true; }
      const rows = await q.listPendingRawChunks('session-a','participant-a','owner-a');
      return {count:rows.length, state:rows[0].state, payload:Array.from(new Uint8Array(rows[0].payload)), collisionRejected,
        lossLogged: localStorage.getItem('mindbreeze:eeg-raw-loss-events').includes('upload_unavailable')};
    });
    // 임시 전용 프로필의 브라우저 프로세스를 닫고 다시 열어 영속성을 확인한다.
    await browser.close();
    browser = await launch();
    page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>EEG queue verification</title>'}));
    await page.goto('https://eeg-queue.test/');
    await install();
    const second = await page.evaluate(async () => {
      const q = window.rawQueue;
      const mine = await q.listPendingRawChunks('session-b','participant-b','owner-a');
      const other = await q.listPendingRawChunks('session-b','participant-b','owner-b');
      const guest = await q.listPendingRawChunks('session-b','participant-b');
      return {persistedAfterRestart: mine.length, otherAccount: other.length, guest: guest.length, payload: Array.from(new Uint8Array(mine[0].payload))};
    });
    const pass = first.count===1 && first.state==='quarantine' && first.collisionRejected && first.lossLogged &&
      JSON.stringify(first.payload)==='[1,2,3,4]' && second.persistedAfterRestart===1 && second.otherAccount===0 && second.guest===0 && JSON.stringify(second.payload)==='[1,2,3,4]';
    console.log(JSON.stringify({engine:'headless Chromium process restart, actual IndexedDB',first,second,pass},null,2));
    if(!pass) process.exitCode=1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
