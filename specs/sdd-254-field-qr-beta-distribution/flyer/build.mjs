#!/usr/bin/env node
// 사용: node build.mjs [vars.json] [출력폴더]  — 변수 JSON → PDF+PNG
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const vars = JSON.parse(readFileSync(resolve(process.argv[2] ?? resolve(here, 'vars.json')), 'utf8'));
const out = resolve(process.argv[3] ?? '/Users/brianyongwookchae/.hermes/share/mb-sdd254-flyer/v2');
mkdirSync(out, { recursive: true });
const root = resolve(here, '../../..');
execFileSync('node', [resolve(root, 'scripts/make-beta-qr.mjs'), 'https://mindbreeze.looxidlabs.com/beta', out]);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const code = String(vars.counselor_code ?? '');
if (!/^[A-Za-z0-9]{6}$/.test(code)) { console.error('counselor_code 는 6자리 영숫자'); process.exit(1); }
const nature = 'data:image/webp;base64,' + readFileSync(resolve(root, 'frontend/public/landing-v6/nature.webp')).toString('base64');
let html = readFileSync(resolve(here, 'template.html'), 'utf8').replace('{{qr_src}}', 'mindbreeze-beta-qr.png').replace('{{nature_src}}', nature);
for (const k of ['class_name','date','place','counselor_code','contact']) html = html.replaceAll(`{{${k}}}`, esc(vars[k] ?? ''));
const h = resolve(out, 'flyer.html'); writeFileSync(h, html);
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pdf = resolve(out, 'mindbreeze-flyer.pdf');
execFileSync(chrome, ['--headless=new','--disable-gpu','--no-pdf-header-footer',`--print-to-pdf=${pdf}`,'file://' + h], { stdio: 'ignore' });
const info = execFileSync('pdfinfo', [pdf]).toString();
if (!/^Pages:\s+1$/m.test(info)) throw new Error('A4 한 장을 초과했습니다. 변수 길이와 레이아웃을 확인하세요.');
execFileSync('pdftoppm', ['-png','-r','150',pdf, resolve(out,'mindbreeze-flyer-preview')]);
console.log(execFileSync('pdfinfo',[pdf]).toString().match(/Pages:.*/)[0], '→', out);
