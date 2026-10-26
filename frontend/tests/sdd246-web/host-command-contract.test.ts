// SDD-246 dev 실측 회귀: 상담사 종료가 missing_field 로 거절되고 REST 폴백이 426 으로 막히던 문제.
// 상담사 화면이 보내는 v2 명령 payload 가 계약(command.schema.json)의 필수 필드를 모두 싣는지 고정한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(
  readFileSync(resolve(__dirname, '../../../contracts/session-live-v2/schema/command.schema.json'), 'utf8'),
) as unknown;

function requiredPayload(kind: string): string[] {
  let found: string[] | null = null;
  const walk = (o: unknown): void => {
    if (found || o === null || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    const props = rec.properties as Record<string, { const?: string; required?: string[] }> | undefined;
    if (props?.kind?.const === kind) {
      found = (props.payload?.required as string[] | undefined) ?? [];
      return;
    }
    Object.values(rec).forEach(walk);
  };
  walk(schema);
  if (!found) throw new Error(`kind 없음: ${kind}`);
  return found;
}

const page = readFileSync(resolve(__dirname, '../../src/pages/sessions/ClassPlayerPage.tsx'), 'utf8');

describe('상담사 v2 명령 payload 계약', () => {
  it('session.end/cancel 은 reason 을 싣는다', () => {
    expect(requiredPayload('session.end')).toEqual(['reason']);
    expect(page).toMatch(/action === 'end' \|\| action === 'cancel' \? \{ reason: 'host_request' \}/);
  });

  it.each([
    ['hand.lower', /request\('hand\.lower', \{([^}]*)\}/],
    ['speaking.set', /request\('speaking\.set', \{([^}]*)\}/],
  ])('%s 는 계약 필수 필드를 모두 싣는다', (kind, re) => {
    const m = page.match(re);
    expect(m).not.toBeNull();
    for (const f of requiredPayload(kind)) expect(m![1]).toContain(f);
  });

  it('audio.set 은 expected_revision 을 싣는다', () => {
    const block = page.slice(page.indexOf("sendCommand('audio.set'"), page.indexOf("sendCommand('audio.set'") + 400);
    for (const f of requiredPayload('audio.set')) expect(block).toContain(f);
  });
});

describe('REST 에 X-Live-Protocol 을 싣는다', () => {
  it('apiClient 공통 헤더에 v2 지원 버전이 들어간다', () => {
    const client = readFileSync(resolve(__dirname, '../../src/lib/api/client.ts'), 'utf8');
    expect(client).toMatch(/'X-Live-Protocol': '1,2'/);
    expect(client).toMatch(/\.\.\.liveProtocolHeaders\(\), \.\.\.headers/);
  });
});
