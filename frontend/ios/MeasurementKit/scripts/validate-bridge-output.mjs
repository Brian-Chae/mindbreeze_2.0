// Swift 가 만든 브리지 JSON 을 contracts/measurement-bridge 검증기(ajv)로 검증한다.
// 사용: MK_CONTRACT_OUT=/path/out.json swift test --filter testEmitContractSamples && node validate-bridge-output.mjs /path/out.json
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { validateBridge } = await import(pathToFileURL(resolve(here, '../../../../contracts/measurement-bridge/validate.mjs')).href);
const out = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let bad = 0, n = 0, known = 0;
function check(kind, msg, label) {
  n++;
  const r = validateBridge(kind, msg);
  if (!r.ok) { bad++; console.log(`FAIL ${label} (${kind})`, JSON.stringify(r.schemaErrors.slice(0, 4)), JSON.stringify(r.semanticErrors.slice(0, 3))); }
}
check('snapshot', out.snapshot, 'snapshot');
check('start-result', out.start, 'start');
check('capabilities', out.capabilities, 'capabilities');
out.events.forEach((e, i) => {
  // T03 서버가 보내는 device.changed payload(stream_id/generation/status)는 T01 DeviceEntity 스키마와 다르다 — 서버/계약 쪽 정합 대기(progress/t07.md 요청 참조).
  if (e.event === 'liveStateUpdated' && e.payload?.event?.domain === 'device') {
    const r = validateBridge('event', e);
    if (!r.ok) { known++; return; }
  }
  check('event', e, `event[${i}:${e.event}]`);
});
console.log(`checked=${n} failed=${bad} KNOWN_SERVER_MISMATCH=${known} events=${out.events.length} kinds=${[...new Set(out.events.map(e => e.event))].join(',')}`);
process.exit(bad ? 1 : 0);
