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

it('채팅 말풍선은 본문 15px·시간 12px·이름 13px을 쓴다(데스크톱 기준)', () => {
  // SDD-234 D: 공용 말풍선 크기는 모바일 미디어쿼리를 쓰기 위해 chat-room.css 클래스로 옮겼다.
  //   데스크톱 기본값(15/13/12, 최대폭 80%)과 테마 muted 색 폴백은 그대로다.
  const bubble = readFileSync(join(SRC, 'components/chat', 'MessageBubble.tsx'), 'utf-8');
  const css = readFileSync(join(SRC, 'components/chat', 'chat-room.css'), 'utf-8');
  const base = css.slice(0, css.indexOf('@media'));
  expect(base).toMatch(/\.chat-msg__bubble \{[^}]*font-size: 15px/);
  expect(base).toMatch(/\.chat-msg__name \{[^}]*font-size: 13px/);
  expect(base).toMatch(/\.chat-msg__time \{[^}]*font-size: 12px/);
  expect(base).toMatch(/\.chat-msg__body \{[^}]*max-width: 80%/);
  expect(bubble).toContain("className=\"chat-msg__name\" style={{ color: 'var(--chat-muted, #6F6F6F)' }}");
  expect(bubble).toContain("className=\"chat-msg__time\" style={{ color: 'var(--chat-muted, #6F6F6F)'");
  expect(bubble).not.toMatch(/#9CA0AE/); // 낮은 대비 시간색 금지

  // AI 말풍선은 기존 인라인 규격을 유지한다.
  const agent = readFileSync(join(SRC, 'components/chat', 'agent-bubble.tsx'), 'utf-8');
  expect(agent).toMatch(/fontSize: '15px'/);
  expect(agent).toContain("fontSize: '13px', color: '#6F6F6F'");
  expect(agent).toContain("fontSize: '12px', color: '#6F6F6F'");
  expect(agent).not.toMatch(/#9CA0AE'?, flexShrink/);
  expect(agent).toMatch(/maxWidth: '80%'/);
});

it('Tailwind text-sm 은 15px/22px', () => {
  const cfg = readFileSync(resolve(process.cwd(), 'tailwind.config.cjs'), 'utf-8');
  expect(cfg).toMatch(/sm: \['15px', \{ lineHeight: '22px' \}\]/);
});
