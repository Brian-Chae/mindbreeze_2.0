// SDD-246 T01 — measurement-bridge + core ABI 계약 검증기.
// session-live-v2 스키마를 같은 ajv 에 등록해 교차 참조($ref)를 해석하고, 누출 규칙은 session-live-v2 검증기를 재사용한다.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_DIR as LIVE_DIR, SCHEMA_BASE as LIVE_BASE, scanLeaks, checkU64Ranges } from '../session-live-v2/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(HERE, '../../frontend/package.json'));
const Ajv = req('ajv');
export const BRIDGE_DIR = join(HERE, 'schema');
export const BRIDGE_BASE = 'https://contracts.mindbreeze.local/measurement-bridge/';

export const REFS = {
  capabilities: ['bridge.schema.json', '#/definitions/Capabilities'],
  'start-request': ['bridge.schema.json', '#/definitions/StartMeasurementRequest'],
  'start-result': ['bridge.schema.json', '#/definitions/StartMeasurementResult'],
  'get-snapshot-request': ['bridge.schema.json', '#/definitions/GetMeasurementSnapshotRequest'],
  snapshot: ['bridge.schema.json', '#/definitions/MeasurementSnapshot'],
  'dispatch-request': ['bridge.schema.json', '#/definitions/DispatchLiveCommandRequest'],
  'dispatch-result': ['bridge.schema.json', '#/definitions/DispatchLiveCommandResult'],
  'stop-request': ['bridge.schema.json', '#/definitions/StopMeasurementRequest'],
  'stop-result': ['bridge.schema.json', '#/definitions/StopMeasurementResult'],
  event: ['bridge.schema.json', '#/definitions/BridgeEvent'],
  'core-config': ['core-abi.schema.json', '#/definitions/CoreConfig'],
  'core-push': ['core-abi.schema.json', '#/definitions/PushPacketCall'],
  'core-output': ['core-abi.schema.json', '#/definitions/CoreOutput'],
  'core-final': ['core-abi.schema.json', '#/definitions/FinalManifest'],
};

// bridge 로 raw 전량/토큰/서명 URL 이 오가면 안 된다 — core-push 의 bytes_base64 만 예외(코어 내부 호출이며 웹뷰 경계가 아님).
const BRIDGE_FORBIDDEN_EXTRA = new Set(['refresh_token', 'access_token', 'raw_samples', 'samples', 'rawSamples', 'refreshToken', 'accessToken', 'presignedUrl']);

let cached = null;
export function ajvInstance() {
  if (cached) return cached;
  const ajv = new Ajv({ allErrors: true, schemaId: '$id', unknownFormats: 'ignore' });
  for (const [dir, base] of [[LIVE_DIR, LIVE_BASE], [BRIDGE_DIR, BRIDGE_BASE]]) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.schema.json')).sort()) {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      s.$id = base + f;
      ajv.addSchema(s, base + f);
    }
  }
  cached = ajv;
  return ajv;
}

function walk(v, path, fn) {
  fn(v, path);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}/${i}`, fn));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}/${k}`, fn);
}

export function validateBridge(kind, message) {
  const [file, frag] = REFS[kind] || [];
  if (!file) throw new Error(`알 수 없는 종류: ${kind}`);
  const validate = ajvInstance().getSchema(BRIDGE_BASE + file + frag);
  if (!validate) throw new Error(`스키마 없음: ${file}${frag}`);
  const ok = validate(message);
  const schemaErrors = ok ? [] : validate.errors.map((e) => ({ keyword: e.keyword, path: e.dataPath, message: e.message }));
  const semanticErrors = [...checkU64Ranges(message)];
  if (kind !== 'core-push') {
    semanticErrors.push(...scanLeaks(message));
    walk(message, '', (v, p) => {
      const key = p.split('/').pop();
      if (key && BRIDGE_FORBIDDEN_EXTRA.has(key) && !(/samples/i.test(key) && !Array.isArray(v))) semanticErrors.push({ rule: 'forbidden_key', path: p, detail: key });
    });
  }
  // 이벤트 순서 필드: managerGeneration 은 반드시 있어야 한다(스키마 required) — 여기서는 세대 비교 유틸을 제공.
  return { ok: schemaErrors.length === 0 && semanticErrors.length === 0, schemaErrors, semanticErrors };
}

/** 소비자(WebView reducer)가 쓰는 세대/순서 판정. 옛 세대는 폐기, 같은 세대의 이전 seq 는 중복. */
export function classifyEvent(current, ev) {
  const g = BigInt(ev.managerGeneration), s = BigInt(ev.seq);
  const cg = BigInt(current.managerGeneration), cs = BigInt(current.seq);
  if (g < cg) return 'discard_stale_generation';
  if (g > cg) return 'resnapshot_new_generation';
  if (s <= cs) return 'discard_duplicate';
  if (s > cs + 1n) return 'gap_resnapshot';
  return 'apply';
}

export function loadFixtures(dir = HERE) {
  const out = [];
  for (const sub of ['valid', 'invalid']) {
    const d = join(dir, 'fixtures', sub);
    for (const n of readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
      const b = JSON.parse(readFileSync(join(d, n), 'utf8'));
      out.push({ name: `${sub}/${n}`, expectValid: sub === 'valid', meta: b.$fixture, message: b.message });
    }
  }
  return out;
}
