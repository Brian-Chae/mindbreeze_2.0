// Android 아카이브 feature alias 가 서버 Alias 규칙(^[A-Z][A-Za-z0-9_-]{0,63}$)을 지키는지 소스 수준에서 고정한다.
// 소문자 시작 alias("nf-…")는 presign 422 로 모든 feature 업로드가 막혔다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_ALIAS = /^[A-Z][A-Za-z0-9_-]{0,63}$/;
const src = readFileSync(resolve(__dirname, '../android/app/src/main/java/com/looxidlabs/mindbreeze/measurement/archive/ArchiveFeeder.kt'), 'utf8');

describe('Android ArchiveFeeder alias 계약', () => {
  it('alias 템플릿이 대문자로 시작하고 서버 규칙을 통과한다', () => {
    const line = src.split('\n').find((l) => l.includes('val alias = '));
    expect(line).toBeDefined();
    expect(line!).toContain('val alias = "NF-');
    const sample = 'NF-00000014-123456789';
    expect(SERVER_ALIAS.test(sample)).toBe(true);
    expect(SERVER_ALIAS.test(sample.replace('NF-', 'nf-'))).toBe(false);
  });
});
