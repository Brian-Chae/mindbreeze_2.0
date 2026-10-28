// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyToast, isPlayerPath, mergeKeyOf } from '../src/lib/notification-toast';
import { useNotificationStore } from '../src/stores/notificationStore';

vi.mock('../src/lib/api/notifications', async (orig) => ({ ...(await orig<object>()), getUnreadCount: vi.fn(async () => ({ unread: 0 })) }));

const classExtra = (sessionId: string) => ({ event_type: 'class_invited', target_type: 'class', target_id: 'c1', params: { start_now: true, session_id: sessionId } });
const store = () => useNotificationStore.getState();
const toast = (id: string, extra: Record<string, unknown> | null = null) => ({ id, type: 'info', title: `t-${id}`, body: 'b', extra });

beforeEach(() => { vi.useFakeTimers(); store().reset(); window.history.pushState(null, '', '/app'); });
afterEach(() => { vi.useRealTimers(); });

describe('SDD-250 토스트 규칙', () => {
  it('유형 판정: 즉석 초대·입장 이벤트만 클래스형', () => {
    expect(classifyToast(classExtra('s1'))).toBe('class');
    expect(classifyToast({ event_type: 'session_started' })).toBe('class');
    expect(classifyToast({ event_type: 'class_invited', params: {} })).toBe('general');
    expect(classifyToast({ event_type: 'report_ready' })).toBe('general');
    expect(classifyToast(null)).toBe('general');
    expect(mergeKeyOf('general', classExtra('s1'))).toBeNull();
    expect(isPlayerPath('/sessions/abc/player')).toBe(true);
    expect(isPlayerPath('/app/sessions/abc')).toBe(false);
  });

  it('TS13 큐: 최신이 앞, 기존 toast 는 최신 1건', () => {
    store().showToast(toast('1')); store().showToast(toast('2')); store().showToast(toast('3')); store().showToast(toast('4'));
    expect(store().toasts.map((t) => t.id)).toEqual(['4', '3', '2', '1']);
    expect(store().toast?.id).toBe('4');
    store().dismissToast();
    expect(store().toast?.id).toBe('3');
  });

  it('TS14 같은 id 는 1회만', () => {
    store().showToast(toast('m1')); store().showToast(toast('m1'));
    expect(store().toasts).toHaveLength(1);
  });

  it('TS15 같은 회차 클래스형 알림은 합친다', () => {
    store().showToast(toast('a', classExtra('s1'))); store().showToast(toast('b', classExtra('s1'))); store().showToast(toast('c', classExtra('s2')));
    expect(store().toasts).toHaveLength(2);
    expect(store().toasts.find((t) => t.id === 'b')?.count).toBe(2);
  });

  it('TS19 노출 시간: 일반 5초, 클래스형 8초, 일시정지 중 유지', () => {
    store().showToast(toast('g')); store().showToast(toast('c', classExtra('s1')));
    vi.advanceTimersByTime(4999); expect(store().toasts).toHaveLength(2);
    vi.advanceTimersByTime(1); expect(store().toasts.map((t) => t.id)).toEqual(['c']);
    store().pauseToast('c'); vi.advanceTimersByTime(20000); expect(store().toasts).toHaveLength(1);
    store().resumeToast('c'); vi.advanceTimersByTime(7999); expect(store().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(store().toasts).toHaveLength(0);
  });

  it('TS16 수업 화면에서는 큐에 넣지 않고, 요약은 1개로 띄운다', () => {
    window.history.pushState(null, '', '/sessions/x/player');
    store().showToast(toast('p1')); expect(store().toasts).toHaveLength(0);
    window.history.pushState(null, '', '/app');
    store().showMissedSummary(3);
    expect(store().toasts).toHaveLength(1);
    expect(store().toasts[0]).toMatchObject({ kind: 'summary', title: '놓친 알림 3건' });
    store().showMissedSummary(0); expect(store().toasts).toHaveLength(1);
  });

  it('reset 은 큐와 타이머를 비운다', () => {
    store().showToast(toast('r')); store().reset();
    expect(store().toasts).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
});
