// Swift 가 만든 브리지 JSON 을 contracts/measurement-bridge 검증기(ajv)로 검증한다.
// 사용: MK_CONTRACT_OUT=/path/out.json swift test --filter testEmitContractSamples && node validate-bridge-output.mjs /path/out.json
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { validateBridge } = await import(pathToFileURL(resolve(here, '../../../../contracts/measurement-bridge/validate.mjs')).href);
const out = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0, n = 0;
function check(kind, msg, label) {
  n++;
  const r = validateBridge(kind, msg);
  if (!r.ok) { bad++; console.log(`FAIL ${label} (${kind})`, JSON.stringify(r.schemaErrors.slice(0, 4)), JSON.stringify(r.semanticErrors.slice(0, 3))); }
}
check('snapshot', out.snapshot, 'snapshot');
check('start-result', out.start, 'start');
check('capabilities', out.capabilities, 'capabilities');
// T05b 로 device.changed 가 DeviceEntity 합집합 스키마가 되어 예외 없이 전부 검증한다.
out.events.forEach((e, i) => check('event', e, `event[${i}:${e.event}]`));
if (out.registerCredential) {
  check('register-credential-request', out.registerCredential.request, 'registerCredential.request');
  check('register-credential-result', out.registerCredential.result, 'registerCredential.result');
}
console.log(`checked=${n} failed=${bad} events=${out.events.length} kinds=${[...new Set(out.events.map(e => e.event))].join(',')}`);
process.exit(bad ? 1 : 0);
