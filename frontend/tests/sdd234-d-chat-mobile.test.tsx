// @vitest-environment jsdom
// SDD-234 D: 채팅 모바일 글자·터치 — 클래스/토큰 계약과 CSS 미디어쿼리 범위를 검증한다.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageBubble } from '../src/components/chat/MessageBubble';
import { SystemMessage } from '../src/components/chat/SystemMessage';
import { ChatSortToggle } from '../src/components/chat/ChatSortToggle';
import { ChatMobileHeader } from '../src/components/chat/ChatMobileHeader';
import type { ChatMessage } from '../src/lib/api/chat';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

function render(node: Parameters<ReturnType<typeof createRoot>['render']>[0]): HTMLDivElement {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container!).render(node); });
  return container;
}

const message = { id: 'm1', room_id: 'r', sender_id: 'u2', content: '긴 한글 https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', type: 'text', created_at: '2026-10-21T10:00:00Z' } as unknown as ChatMessage;
const css = readFileSync(resolve(process.cwd(), 'src/components/chat/chat-room.css'), 'utf8');
const mediaAt = css.search(/@media\s*\(max-width:\s*767px\)/);
const mobileCss = css.slice(mediaAt);
const baseCss = css.slice(0, mediaAt);

it('말풍선은 클래스 기반이며 본문이 인라인 12/15px 고정이 아니다', () => {
  const el = render(createElement(MessageBubble, { message, isMine: false, senderName: '상담사', showSender: true, onReport: vi.fn() }));
  const bubble = el.querySelector('.chat-msg__bubble') as HTMLElement;
  expect(bubble.textContent).toContain('긴 한글');
  expect(bubble.style.fontSize).toBe('');
  expect(el.querySelector('.chat-msg__time')).not.toBeNull();
  expect((el.querySelector('.chat-msg__time') as HTMLElement).style.fontSize).toBe('');
  expect(el.querySelector('button[aria-label="이 메시지 신고"]')?.classList.contains('chat-msg__report')).toBe(true);
});

it('다크 테마 색상 변수 폴백은 그대로 유지된다', () => {
  const el = render(createElement(MessageBubble, { message, isMine: false }));
  const bubble = el.querySelector('.chat-msg__bubble') as HTMLElement;
  expect(bubble.getAttribute('style')).toContain('var(--chat-surface');
  expect(bubble.getAttribute('style')).toContain('var(--chat-text');
});

it('시스템 메시지도 클래스 기반이다', () => {
  const el = render(createElement(SystemMessage, { content: '입장', createdAt: '2026-10-21T10:00:00Z' }));
  expect(el.querySelector('.chat-system')).not.toBeNull();
});

it('정렬 토글·헤더는 모바일 토큰과 터치 영역을 가진다', () => {
  const el = render(createElement('div', null,
    createElement(ChatSortToggle, { unreadFirst: false, onUnreadFirstChange: vi.fn() }),
    createElement(ChatMobileHeader, { title: '방', sub: '보조', onBack: vi.fn() })));
  expect(el.querySelector('label')?.className).toContain('mobile:min-h-11');
  expect(el.querySelector('label')?.className).toContain('mobile:text-mb-caption');
  expect(el.querySelector('h1')?.className).toContain('mobile:text-mb-body');
});

it('CSS: 모바일 값은 767px 미디어쿼리 안에서만 토큰을 쓴다', () => {
  expect(baseCss).not.toContain('--mobile-type');
  expect(mobileCss).toContain('var(--mobile-type-body-size)');
  expect(mobileCss).toContain('var(--mobile-type-caption-size)');
  expect(mobileCss).toContain('var(--mobile-touch-minimum)');
  expect(mobileCss).toContain('var(--mobile-touch-control)');
  // 데스크톱 기본값 유지
  expect(mediaAt).toBeGreaterThan(0);
  expect(baseCss).toMatch(/\.chat-msg__bubble\s*\{[^}]*font-size:\s*15px/);
  expect(baseCss).toMatch(/\.chat-msg__time\s*\{[^}]*font-size:\s*12px/);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
});
