// SDD-246 T01 — measurement-bridge/core-abi fixture 계약 시험 (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtures, validateBridge, classifyEvent, REFS } from './validate.mjs';

const fixtures = loadFixtures();

test('모든 bridge 메시지 종류에 valid fixture 가 있다', () => {
  const covered = new Set(fixtures.filter((f) => f.expectValid).map((f) => f.meta.schema));
  assert.deepEqual(Object.keys(REFS).filter((k) => !covered.has(k)), []);
});
test('bridge 이벤트 4종이 모두 valid fixture 로 있다', () => {
  const names = new Set(fixtures.filter((f) => f.expectValid && f.meta.schema === 'event').map((f) => f.message.event));
  assert.deepEqual([...names].sort(), ['archiveStatus', 'commandAck', 'liveStateUpdated', 'measurementUpdated']);
});
for (const f of fixtures) {
  test(`${f.expectValid ? 'accept' : 'reject'} ${f.name}`, () => {
    const r = validateBridge(f.meta.schema, f.message);
    if (f.expectValid) assert.equal(r.ok, true, JSON.stringify([...r.schemaErrors, ...r.semanticErrors]));
    else {
      assert.equal(r.ok, false, `${f.name} 거절되지 않음: ${f.meta.why}`);
      if (f.meta.reject_by === 'schema') assert.ok(r.schemaErrors.length > 0);
      if (f.meta.reject_by === 'semantic') assert.ok(r.semanticErrors.some((e) => !f.meta.expect_rule || e.rule === f.meta.expect_rule), JSON.stringify(r.semanticErrors));
    }
  });
}
test('이벤트 세대/순서 판정', () => {
  const cur = { managerGeneration: '3', seq: '10' };
  assert.equal(classifyEvent(cur, { managerGeneration: '2', seq: '99' }), 'discard_stale_generation');
  assert.equal(classifyEvent(cur, { managerGeneration: '4', seq: '1' }), 'resnapshot_new_generation');
  assert.equal(classifyEvent(cur, { managerGeneration: '3', seq: '10' }), 'discard_duplicate');
  assert.equal(classifyEvent(cur, { managerGeneration: '3', seq: '12' }), 'gap_resnapshot');
  assert.equal(classifyEvent(cur, { managerGeneration: '3', seq: '11' }), 'apply');
});
