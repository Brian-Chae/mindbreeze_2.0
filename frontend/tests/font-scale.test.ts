// SDD-196 — 글씨 크기 하한·채팅 크기 회귀 가드 (소스 정적 스캔)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
// 목업·개발도구는 실서비스 화면이 아니라 제외한다.
const EXCLUDE = ['pages/design', 'components/playground'];
// 알림 배지 숫자(16~20px 원 안)는 12px 하한의 예외다.
const BADGE = /(h-\[1[68]px\]|min-w-\[(16|18|20)px\]|w-\[1[68]px\]|h-5 w-5|w-5 h-5)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

it('실서비스 화면에는 12px 미만 글씨가 없다(배지 숫자 제외)', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    if (EXCLUDE.some((e) => rel.startsWith(e))) continue;
    readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
      const small = /text-\[(9|10|10\.5|11)px\]/.test(line)
        || /fontSize:\s*['"]?(9|10|10\.5|11)(px)?['"]?[,\s}]/.test(line);
      if (small && !BADGE.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});

it('채팅 말풍선은 본문 15px·시간 12px·이름 13px을 쓴다', () => {
  for (const f of ['MessageBubble.tsx', 'agent-bubble.tsx']) {
    const src = readFileSync(join(SRC, 'components/chat', f), 'utf-8');
    expect(src).toMatch(/fontSize: '15px'/); // 본문
    expect(src).toMatch(/fontSize: '13px', color: '#6F6F6F'/); // 이름
    expect(src).toMatch(/fontSize: '12px', color: '#6F6F6F'/); // 시간(대비 5:1)
    expect(src).not.toMatch(/#9CA0AE'?, flexShrink/); // 낮은 대비 시간색 금지
    expect(src).toMatch(/maxWidth: '80%'/);
  }
});

it('Tailwind text-sm 은 15px/22px', () => {
  const cfg = readFileSync(resolve(process.cwd(), 'tailwind.config.cjs'), 'utf-8');
  expect(cfg).toMatch(/sm: \['15px', \{ lineHeight: '22px' \}\]/);
});
