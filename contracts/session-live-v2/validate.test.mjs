// SDD-246 T01 — session-live-v2 fixture 계약 시험 (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures, validateMessage, MESSAGE_REFS } from './validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtures = loadFixtures(HERE);

test('fixture 가 존재한다', () => {
  assert.ok(fixtures.length >= 30, `fixture ${fixtures.length}건`);
});

test('모든 메시지 종류에 valid fixture 가 최소 1건 있다', () => {
  const covered = new Set(fixtures.filter((f) => f.expectValid).map((f) => f.meta.schema));
  const missing = Object.keys(MESSAGE_REFS).filter((k) => !covered.has(k));
  assert.deepEqual(missing, []);
});

for (const f of fixtures) {
  test(`${f.expectValid ? 'accept' : 'reject'} ${f.name}`, () => {
    const r = validateMessage(f.meta.schema, f.message);
    if (f.expectValid) {
      assert.equal(r.ok, true, JSON.stringify([...r.schemaErrors, ...r.semanticErrors]));
    } else {
      assert.equal(r.ok, false, `${f.name} 이 거절되지 않음: ${f.meta.why}`);
      const by = f.meta.reject_by;
      if (by === 'schema') assert.ok(r.schemaErrors.length > 0, '스키마 오류 기대');
      if (by === 'semantic') {
        assert.ok(r.semanticErrors.length > 0, '의미 규칙 오류 기대');
        if (f.meta.expect_rule) assert.ok(r.semanticErrors.some((e) => e.rule === f.meta.expect_rule), `규칙 ${f.meta.expect_rule} 기대: ${JSON.stringify(r.semanticErrors)}`);
      }
    }
  });
}
