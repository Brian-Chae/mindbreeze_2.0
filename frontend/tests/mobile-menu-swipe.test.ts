// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getMobileMenuTabs, getSwipeRootIndex, getSwipeAxis, shouldCommitSwipe, resistSwipe, getSwipeTargetIndex } from '../src/lib/mobile-menu-swipe';
import { hasMobileSwipeProtection, registerMobileSwipeProtection, isSwipeTargetExcluded, hasSwipeDomProtection } from '../src/lib/mobile-menu-swipe-protection';

describe('모바일 메뉴 순서와 정확한 루트', () => {
  it('세 역할의 실제 공개 메뉴 순서만 제공한다', () => {
    expect(getMobileMenuTabs('client', false).map(t => t.to)).toEqual(['/app', '/app/classes', '/app/chat', '/app/reports', '/app/profile']);
    expect(getMobileMenuTabs('client', true)[2].to).toBe('/app/counseling');
    for (const role of ['counselor', 'org_admin'] as const) {
      expect(getMobileMenuTabs(role, false).map(t => t.to)).toEqual([role === 'org_admin' ? '/dashboard/org' : '/dashboard', '/classes', '/reports', '/chat', '/settings']);
      expect(getMobileMenuTabs(role, true)[2].to).toBe('/counseling');
    }
    expect(getMobileMenuTabs('platform_admin', false)).toEqual([]);
    expect(getMobileMenuTabs(undefined, false)).toEqual([]);
  });
  it('끝 슬래시는 허용하고 상세와 다른 역할 루트는 제외한다', () => {
    const tabs = getMobileMenuTabs('client', false);
    expect(getSwipeRootIndex('/app/classes/', tabs)).toBe(1);
    expect(getSwipeRootIndex('/app/classes/123', tabs)).toBe(-1);
    expect(getSwipeRootIndex('/classes', tabs)).toBe(-1);
  });
});

describe('거리·방향·속도 판정', () => {
  it('12px 이전 정지, 500ms 이내 1.5배 수평만 잠근다', () => {
    expect(getSwipeAxis(11, 0, 30)).toBe('pending');
    expect(getSwipeAxis(12, 8, 500)).toBe('horizontal');
    expect(getSwipeAxis(12, 9, 40)).toBe('cancel');
    expect(getSwipeAxis(11, 11, 40)).toBe('cancel');
    expect(getSwipeAxis(0, 12, 40)).toBe('cancel');
    expect(getSwipeAxis(20, 0, 501)).toBe('cancel');
  });
  it('390px에서 양방향 78px 경계와 짧은 복귀', () => {
    expect(shouldCommitSwipe(-78, 390, [])).toBe(true);
    expect(shouldCommitSwipe(78, 390, [])).toBe(true);
    expect(shouldCommitSwipe(77, 390, [])).toBe(false);
    expect(shouldCommitSwipe(-30, 390, [{ x: 0, time: 0 }, { x: -30, time: 300 }])).toBe(false);
  });
  it('40px+0.5px/ms, 최근80ms·최소16ms·방향 일치 플릭만 허용한다', () => {
    expect(shouldCommitSwipe(-40, 390, [{ x: 0, time: 0 }, { x: -40, time: 80 }])).toBe(true);
    expect(shouldCommitSwipe(-39, 390, [{ x: 0, time: 0 }, { x: -39, time: 40 }])).toBe(false);
    expect(shouldCommitSwipe(-40, 390, [{ x: 0, time: 0 }, { x: -40, time: 10 }])).toBe(false);
    expect(shouldCommitSwipe(-45, 390, [{ x: -70, time: 50 }, { x: -45, time: 80 }])).toBe(false);
    expect(shouldCommitSwipe(-45, 390, [{ x: 0, time: 0 }, { x: -44, time: 100 }, { x: -45, time: 180 }])).toBe(false);
    expect(resistSwipe(120)).toBeCloseTo(26.4);
    expect(resistSwipe(-300)).toBe(-32);
  });
});

describe('보호 수명과 DOM', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  it('등록 콜백의 현재 상태를 평가하고 해제한다', () => {
    let busy = false;
    const release = registerMobileSwipeProtection(() => busy);
    expect(hasMobileSwipeProtection()).toBe(false);
    busy = true;
    expect(hasMobileSwipeProtection()).toBe(true);
    busy = false;
    expect(hasMobileSwipeProtection()).toBe(false);
    release();
    expect(hasMobileSwipeProtection()).toBe(false);
  });
  it('입력 포커스와 blur 후 미전송 값을 모두 보호한다', () => {
    document.body.innerHTML = '<input /><textarea></textarea>';
    const input = document.querySelector('input')!;
    input.focus();
    expect(hasSwipeDomProtection(document)).toBe(true);
    input.value = '아직 전송하지 않은 내용';
    input.blur();
    expect(hasSwipeDomProtection(document)).toBe(true);
    input.value = '';
    expect(hasSwipeDomProtection(document)).toBe(false);
  });
  it('숨겨진 조상의 입력과 모달은 보호하지 않는다', () => {
    document.body.innerHTML = '<div style="display:none"><input value="hidden" /><div role="dialog"></div></div>';
    expect(hasSwipeDomProtection(document)).toBe(false);
  });
  it('dialog·범용 실제 오버레이·data 보호를 감지한다', () => {
    for (const html of ['<div role="dialog"></div>', '<div class="fixed inset-0 z-50"></div>', '<div data-mobile-swipe-block></div>']) {
      document.body.innerHTML = html;
      expect(hasSwipeDomProtection(document)).toBe(true);
    }
  });
  it('버튼·레일·표·차트는 출발 위치에서 제외한다', () => {
    document.body.innerHTML = '<main><button><span id="button"></span></button><div style="overflow-x:auto"><span id="rail"></span></div><table><tbody><tr><td id="table"></td></tr></tbody></table><div class="recharts-wrapper" id="chart"></div><p id="body"></p></main>';
    const root = document.querySelector('main')!;
    for (const id of ['button', 'rail', 'table', 'chart']) expect(isSwipeTargetExcluded(document.getElementById(id)!, root)).toBe(true);
    expect(isSwipeTargetExcluded(document.getElementById('body')!, root)).toBe(false);
  });
});

describe('메뉴 끝 순환', () => {
  it('마지막 탭(설정)에서 다음으로 넘기면 첫 탭(홈)으로, 첫 탭에서 이전으로 넘기면 마지막 탭으로 간다', () => {
    expect(getSwipeTargetIndex(4, -100, 5)).toBe(0);
    expect(getSwipeTargetIndex(0, 100, 5)).toBe(4);
    expect(getSwipeTargetIndex(2, -100, 5)).toBe(3);
    expect(getSwipeTargetIndex(2, 100, 5)).toBe(1);
  });
  it('탭이 하나뿐이거나 루트가 아니면 이동하지 않는다', () => {
    expect(getSwipeTargetIndex(0, -100, 1)).toBe(-1);
    expect(getSwipeTargetIndex(-1, -100, 5)).toBe(-1);
  });
});
