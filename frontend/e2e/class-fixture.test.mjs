import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassFixture } from './class-fixture.mjs';

for (const instant of [false, true]) {
  test(`새 클래스 API 계약: instant=${instant}`, async () => {
    let request;
    const result = await createClassFixture({ api: 'https://test/api/v1', token: 'test-token',
      hostId: 'host', title: '합성 클래스', memberIds: ['member'], instant,
      scheduledAt: '2026-10-20T16:15:00Z',
      fetcher: async (url, init) => {
        request = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ class_id: 'parent', session_ids: instant ? ['one'] : ['one','two'] }), { status: 201 });
      } });
    assert.equal(request.url, 'https://test/api/v1/classes');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Authorization, 'Bearer test-token');
    assert.ok(request.body.operation_key);
    const s = request.body.schedule;
    assert.equal(s.planned_session_count, instant ? 1 : 2);
    assert.equal(s.recurrence_rule.start_now, instant);
    assert.equal(s.recurrence_rule.start_date, '2026-10-21');
    assert.equal(s.recurrence_rule.time, '01:15');
    assert.deepEqual(s.recurrence_rule.weekdays, [2]);
    assert.deepEqual(s.assignment_rule, { mode: 'all_one', host_ids: ['host'] });
    assert.deepEqual(s.member_ids, ['member']);
    assert.deepEqual(s.reminder_offsets, []);
    assert.equal(result.class_id, 'parent');
    assert.equal(result.session_ids.length, instant ? 1 : 2);
  });
}
test('생성 실패 원인을 숨기거나 기존 API로 우회하지 않는다', async () => {
  let calls = 0;
  await assert.rejects(createClassFixture({ api: 'https://test/api/v1', token: 'x', hostId: 'host', title: '합성',
    fetcher: async () => { calls++; return new Response(JSON.stringify({ detail: { code: 'schedule_conflict' } }), { status: 409 }); } }), /409.*schedule_conflict/);
  assert.equal(calls, 1);
});
