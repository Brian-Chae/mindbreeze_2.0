// SDD-246 T01 — session-live-v2 계약 검증기 (JSON Schema draft-07 + 의미 규칙).
// ajv 는 frontend/node_modules 의 것을 쓴다(저장소 루트에 별도 의존성을 만들지 않는다).
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = join(HERE, 'schema');
const req = createRequire(resolve(HERE, '../../frontend/package.json'));
const Ajv = req('ajv');

export const SCHEMA_BASE = 'https://contracts.mindbreeze.local/session-live-v2/';

/** 메시지 종류 → 스키마 ref */
export const MESSAGE_REFS = {
  command: 'command.schema.json',
  event: 'event.schema.json',
  ack: 'ack.schema.json',
  snapshot: 'snapshot.schema.json',
  'metric-envelope': 'metric.schema.json#/definitions/MetricEnvelope',
  'metric-batch': 'metric.schema.json#/definitions/MetricBatch',
  'metric-ack': 'metric.schema.json#/definitions/MetricAckBatch',
  hello: 'wire.schema.json#/definitions/Hello',
  join: 'wire.schema.json#/definitions/Join',
  'clock-probe': 'wire.schema.json#/definitions/ClockProbe',
  device: 'wire.schema.json#/definitions/Device',
  presence: 'wire.schema.json#/definitions/Presence',
  applied: 'wire.schema.json#/definitions/Applied',
  rendered: 'wire.schema.json#/definitions/Rendered',
  resync: 'wire.schema.json#/definitions/Resync',
  heartbeat: 'wire.schema.json#/definitions/Heartbeat',
  'sync-complete': 'wire.schema.json#/definitions/SyncComplete',
  'access-revoked': 'wire.schema.json#/definitions/AccessRevoked',
  terminal: 'wire.schema.json#/definitions/Terminal',
};

export function loadSchemas(dir = SCHEMA_DIR, base = SCHEMA_BASE) {
  const ajv = new Ajv({ allErrors: true, schemaId: '$id', unknownFormats: 'ignore' });
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.schema.json')).sort()) {
    const schema = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    schema.$id = base + f;
    ajv.addSchema(schema, base + f);
  }
  return ajv;
}

let cached = null;
function ajvInstance() {
  if (!cached) cached = loadSchemas();
  return cached;
}

const U64_MAX = 18446744073709551615n;
const SEQ_KEYS = /(^|_)(seq|sequence|cursor|generation|revision|version|ticks|us)$/;

/** 개인정보·비밀 누출 패턴 — 스키마 additionalProperties:false 와 별개의 이중 방어. */
export const FORBIDDEN_KEYS = new Set([
  'email', 'name', 'display_name', 'full_name', 'phone', 'phone_number', 'address', 'birth_date', 'gender',
  'access_token', 'refresh_token', 'token', 'authorization', 'password', 'secret', 'api_key',
  'presigned_url', 'signed_url', 'url', 'raw_samples', 'samples', 'raw',
  'total_score', 'meditation_total_score', 'overall_score', 'composite_score',
]);
/** raw 샘플 계열 키는 배열(샘플 열)일 때만 누출로 본다 — `samples: {eeg: "720"}` 같은 카운터 객체는 정상. */
const RAW_ARRAY_KEYS = new Set(['samples', 'raw_samples', 'raw']);
const FORBIDDEN_VALUE_PATTERNS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'email_address'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i, 'bearer_token'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, 'jwt'],
  [/X-Amz-(Signature|Credential)=/i, 'presigned_url'],
  [/https?:\/\/[^\s"]*\?[^\s"]*(signature|token)=/i, 'signed_url'],
];

function walk(value, path, visit) {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}/${i}`, visit));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, `${path}/${k}`, visit);
  }
}

export function scanLeaks(message) {
  const errs = [];
  walk(message, '', (v, path) => {
    const key = path.split('/').pop();
    if (key && FORBIDDEN_KEYS.has(key) && !(RAW_ARRAY_KEYS.has(key) && !Array.isArray(v))) errs.push({ rule: 'forbidden_key', path, detail: key });
    if (typeof v === 'string') {
      for (const [re, name] of FORBIDDEN_VALUE_PATTERNS) if (re.test(v)) errs.push({ rule: name, path });
    }
  });
  return errs;
}

const PUBLIC_DOMAINS = new Set(['session', 'audio', 'policy', 'aggregate']);
const MEMBER_DOMAINS = new Set(['session', 'audio', 'policy', 'aggregate', 'participation', 'waiting', 'speaking', 'signal', 'device', 'metrics']);
const PER_PARTICIPANT_DOMAINS = new Set(['participation', 'waiting', 'speaking', 'signal', 'device', 'metrics']);

function audienceOwner(aud) {
  return aud.startsWith('member:') ? aud.slice(7) : null;
}

/** audience 범위 규칙: public 은 공용 domain 만, member 는 본인 항목만. */
export function checkAudienceScope(kind, msg) {
  const errs = [];
  const pid = (p) => (p && typeof p === 'object' ? p.participant_id : undefined);
  if (kind === 'event') {
    const { audience, domain, payload } = msg;
    if (audience === 'public' && !PUBLIC_DOMAINS.has(domain)) errs.push({ rule: 'audience_scope', detail: `public audience 에 ${domain} domain 금지` });
    const owner = audienceOwner(audience || '');
    if (owner) {
      if (!MEMBER_DOMAINS.has(domain)) errs.push({ rule: 'audience_scope', detail: `member audience 에 ${domain} domain 금지` });
      if (PER_PARTICIPANT_DOMAINS.has(domain) && pid(payload) && pid(payload) !== owner) {
        errs.push({ rule: 'audience_scope', detail: '다른 참여자 항목이 member audience 에 포함됨' });
      }
    }
  } else if (kind === 'snapshot') {
    const auds = msg.audiences || [];
    const owners = auds.map(audienceOwner).filter(Boolean);
    const hasHost = auds.includes('host');
    if (!hasHost) {
      for (const dom of ['participation', 'waiting', 'speaking', 'signal', 'device', 'metrics']) {
        const block = msg[dom === 'participation' ? 'participation' : dom === 'metrics' ? 'metrics' : dom];
        if (!block || !block.entities) continue;
        for (const [eid, ent] of Object.entries(block.entities)) {
          const owner = ent && ent.data && ent.data.participant_id;
          if (owner && !owners.includes(owner)) errs.push({ rule: 'audience_scope', detail: `${dom}.${eid}: 승인되지 않은 참여자 항목` });
        }
      }
      if (msg.aggregates && msg.aggregates.entities) {
        // 집계는 허용: 개별 식별자 키 없음은 스키마가 보장한다.
      }
    }
  }
  return errs;
}

/** 64비트 문자열 값 범위(0..2^64-1) 검사 — 십진 문자열만 허용되므로 BigInt 로 비교. */
export function checkU64Ranges(message) {
  const errs = [];
  walk(message, '', (v, path) => {
    const key = path.split('/').pop() || '';
    if (typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && (SEQ_KEYS.test(key) || v.length >= 20) && BigInt(v) > U64_MAX) {
      errs.push({ rule: 'u64_overflow', path });
    }
  });
  return errs;
}

export function checkMetricSemantics(kind, msg) {
  const errs = [];
  const envs = kind === 'metric-envelope' ? [msg] : kind === 'metric-batch' ? msg.windows || [] : [];
  envs.forEach((e, i) => {
    try {
      if (BigInt(e.window_end_us) <= BigInt(e.window_start_us)) errs.push({ rule: 'window_order', path: `/windows/${i}` });
    } catch { /* 스키마가 잡는다 */ }
  });
  return errs;
}

/** @returns {{ok:boolean, schemaErrors:object[], semanticErrors:object[]}} */
export function validateMessage(kind, message, { ajv = ajvInstance(), refs = MESSAGE_REFS, base = SCHEMA_BASE } = {}) {
  let ref = refs[kind];
  if (!ref) throw new Error(`알 수 없는 메시지 종류: ${kind}`);
  const preErrors = [];
  // command/event 는 kind 로 분기를 먼저 고른다 — oneOf 오류에 진짜 사유가 가려지지 않게 한다.
  if (kind === 'command' || kind === 'event') {
    const root = ajv.getSchema(base + ref).schema;
    const idx = root.oneOf.findIndex((b) => b.properties.kind.const === (message && message.kind));
    if (idx < 0) preErrors.push({ keyword: 'unknown_kind', path: '.kind', message: 'kind 는 계약에 정의된 값이어야 함', params: {} });
    else ref = `${ref}#/oneOf/${idx}`;
  }
  let schemaErrors = preErrors;
  if (preErrors.length === 0) {
    const validate = ajv.getSchema(base + ref);
    if (!validate) throw new Error(`스키마 없음: ${ref}`);
    const ok = validate(message);
    schemaErrors = ok ? [] : validate.errors.map((e) => ({ keyword: e.keyword, path: e.dataPath, message: e.message, params: e.params }));
  }
  const semanticErrors = [
    ...scanLeaks(message),
    ...checkAudienceScope(kind, message),
    ...checkU64Ranges(message),
    ...checkMetricSemantics(kind, message),
  ];
  return { ok: schemaErrors.length === 0 && semanticErrors.length === 0, schemaErrors, semanticErrors };
}

/** fixture 파일 규약: {"$fixture":{"schema":"command","why":"..","reject_by":"schema|semantic","expect_rule":".."},"message":{..}} */
export function loadFixtures(dir) {
  const out = [];
  for (const sub of ['valid', 'invalid']) {
    const d = join(dir, 'fixtures', sub);
    let names = [];
    try { names = readdirSync(d).filter((n) => n.endsWith('.json')).sort(); } catch { /* none */ }
    for (const n of names) {
      const body = JSON.parse(readFileSync(join(d, n), 'utf8'));
      out.push({ name: `${sub}/${n}`, expectValid: sub === 'valid', meta: body.$fixture, message: body.message });
    }
  }
  return out;
}
