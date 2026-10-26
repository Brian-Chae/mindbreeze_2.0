// @vitest-environment jsdom
// 홈 이번 주 클래스 행 칩 한 줄 유지 + 회원 로그인 하단 링크 흰 글씨.
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { ClassRow } from '../src/components/class/flow/shell/ClassRow';

test('부제(일시 · 진행자)는 두 줄로 나뉜다', () => {
  const el = document.createElement('div');
  act(() => { createRoot(el).render(<ClassRow data={{ id: '1', title: 'T', sub: '내일 오전 10:00 · 김하늘 상담사', chip: 'done' as never }} onOpen={() => {}} />); });
  const subs = [...el.querySelectorAll('.sh-row__sub')].map((n) => n.textContent);
  expect(subs).toEqual(['내일 오전 10:00', '김하늘 상담사']);
});

test('행 안의 상태 칩은 줄바꿈하지 않는다', () => {
  const css = readFileSync('src/components/class/flow/shell/shell-kit.css', 'utf8');
  expect(css).toContain('.sh-row > .sh-chip { flex: none; white-space: nowrap; }');
});

test('회원 로그인의 비밀번호 찾기·회원가입은 흰 글씨', () => {
  const src = readFileSync('src/pages/LoginPage.tsx', 'utf8');
  expect(src).toContain('className="text-white underline">비밀번호 찾기');
  expect(src).toContain('className="font-semibold text-white underline">회원가입');
});
