// native(Swift)가 서버로 보내는 Socket.IO wire 메시지를 contracts/session-live-v2 검증기(ajv + 누출·u64 규칙)로 검증한다.
// 사용: MK_WIRE_OUT=/path/wire.json swift test --filter NativeWireContractTests && node validate-wire-output.mjs /path/wire.json
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { validateMessage } = await import(pathToFileURL(resolve(here, '../../../../contracts/session-live-v2/validate.mjs')).href);
const out = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0;
const byKind = {};
for (const [i, m] of out.entries()) {
  const label = m.kind === 'command' ? `command:${m.message.kind}` : m.kind;
  byKind[label] = (byKind[label] || 0) + 1;
  const r = validateMessage(m.kind, m.message);
  if (!r.ok) { bad++; console.log(`FAIL [${i}] ${m.event} (${label})`, JSON.stringify(r.schemaErrors.slice(0, 4)), JSON.stringify(r.semanticErrors.slice(0, 3))); }
}
console.log(`checked=${out.length} failed=${bad} kinds=${JSON.stringify(byKind)}`);
process.exit(bad ? 1 : 0);
