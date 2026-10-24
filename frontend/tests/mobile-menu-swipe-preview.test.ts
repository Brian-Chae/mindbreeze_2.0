// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountSwipeSnapshot, resetSwipeSnapshots, saveSwipeSnapshot } from '../src/lib/mobile-menu-swipe-preview';

describe('방문 화면 시각 사본', () => {
  it('실제 방문 화면만 inert 복제하고 id·상호작용·실행 요소를 제거한다', () => {
    resetSwipeSnapshots('member-A');
    const source = document.createElement('div');
    source.innerHTML = '<h2 id="title">방문한 내 클래스</h2><button id="join" onclick="bad()">참여</button><a href="/danger">이동</a><script>bad()</script><p id="tail">뒤쪽 본문</p>';
    source.style.transform = 'translate3d(-120px,0,0)'; source.scrollTop = 155;
    saveSwipeSnapshot('member-A', '/app/classes', source);
    const parent = document.createElement('div');
    expect(mountSwipeSnapshot('member-A', '/app/reports', parent)).toBe(false);
    expect(mountSwipeSnapshot('member-A', '/app/classes', parent)).toBe(true);
    expect(parent.textContent).toContain('방문한 내 클래스');
    expect(parent.querySelector('[id],script,[onclick],a[href]')).toBeNull();
    expect(parent.firstElementChild?.hasAttribute('inert')).toBe(true);
    expect(parent.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect((parent.firstElementChild as HTMLElement).scrollTop).toBe(155);
    expect((parent.firstElementChild as HTMLElement).style.transform).toBe('');
    expect(parent.querySelector('button')?.tabIndex).toBe(-1);
  });
  it('계정·역할 변경 시 폐기하며 이전 cleanup도 새 계정에 쓰지 못한다', () => {
    resetSwipeSnapshots('member-A'); saveSwipeSnapshot('member-A', '/app', document.createElement('div'));
    resetSwipeSnapshots('counselor-B');
    expect(mountSwipeSnapshot('member-A', '/app', document.createElement('div'))).toBe(false);
    saveSwipeSnapshot('member-A', '/app', document.createElement('div'));
    expect(mountSwipeSnapshot('counselor-B', '/app', document.createElement('div'))).toBe(false);
  });
  it('최대 네 화면만 보관한다', () => {
    resetSwipeSnapshots('bounded');
    for (let index = 0; index < 5; index++) saveSwipeSnapshot('bounded', `/${index}`, document.createElement('div'));
    expect(mountSwipeSnapshot('bounded', '/0', document.createElement('div'))).toBe(false);
    expect(mountSwipeSnapshot('bounded', '/4', document.createElement('div'))).toBe(true);
  });
});
