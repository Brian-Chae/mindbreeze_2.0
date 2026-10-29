import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** normalization/algorithm 산출물 PUT 은 application/json 으로 서명하면 Android 네이티브 HTTP 가 본문을 깨뜨린다(영구 pending). */
describe('산출물 content_type', () => {
  const block = (file: string, marker: string): string => {
    const lines = readFileSync(resolve(__dirname, '../src/lib/biosignal', file), 'utf8').split('\n');
    const at = lines.findIndex(l => l.includes(marker));
    expect(at).toBeGreaterThanOrEqual(0);
    return lines.slice(at, at + 3).join('\n');
  };
  it.each([['display-snapshot.ts', "artifact_kind: 'normalization'"], ['feature-collector.ts', "artifact_kind: 'algorithm'"]])('%s %s 는 octet-stream', (file, marker) => {
    const text = block(file, marker);
    expect(text).toContain("content_type: 'application/octet-stream'");
    expect(text).not.toContain("content_type: 'application/json'");
  });
});
