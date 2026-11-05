#!/usr/bin/env node
// 현장 QR 생성 (SDD-254). 사용: node scripts/make-beta-qr.mjs [랜딩URL] [출력폴더]
// QR 에는 랜딩 주소만 넣는다(APK·TestFlight 링크는 beta.json 에서 교체). 오류정정 Q, 여백 4칸.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const QRCode = require('qrcode');

const url = process.argv[2] ?? 'https://mindbreeze.looxidlabs.com/beta';
const out = resolve(process.argv[3] ?? 'out/beta-qr');
if (!/^https:\/\//.test(url)) { console.error('https 주소만 허용합니다:', url); process.exit(1); }
mkdirSync(out, { recursive: true });
const opts = { errorCorrectionLevel: 'Q', margin: 4 };
writeFileSync(resolve(out, 'mindbreeze-beta-qr.svg'), await QRCode.toString(url, { ...opts, type: 'svg' }));
await QRCode.toFile(resolve(out, 'mindbreeze-beta-qr.png'), url, { ...opts, width: 1200 });
console.log('생성 완료:', out, '→', url);
