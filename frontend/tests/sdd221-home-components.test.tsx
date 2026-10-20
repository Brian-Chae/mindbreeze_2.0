// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatTile } from '../src/components/dashboard/stat-tile';
import { ClickableCard, CardAction } from '../src/components/dashboard/clickable-card';
import { NotificationRow } from '../src/components/dashboard/notification-row';
import type { NotificationDto } from '../src/lib/api/notifications';

const api = vi.hoisted(() => ({ markRead: vi.fn() }));
vi.mock('../src/lib/api/notifications', async (orig) => ({
  ...(await orig<typeof import('../src/lib/api/notifications')>()),
  markRead: api.markRead,
}));

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname}{l.search}</div>;
}
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;
function mount(ui: React.ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(<MemoryRouter><Routes><Route path="*" element={<>{ui}<Loc /></>} /></Routes></MemoryRouter>));
  return host;
}
afterEach(() => { flushSync(() => root?.unmount()); host?.remove(); vi.clearAllMocks(); });
const loc = () => document.querySelector('[data-testid=loc]')!.textContent;
const flush = () => new Promise((r) => setTimeout(r, 50));

describe('SDD-221 컴포넌트', () => {
  it('StatTile: 전체가 링크, aria-label, 클릭 이동', async () => {
    const h = mount(<StatTile label="검토 대기" value={7} to="/reports?status=pending" hint="리포트 검토 →" />);
    const a = h.querySelector('a')!;
    expect(a.getAttribute('aria-label')).toBe('검토 대기 7, 리포트 검토');
    a.click();
    await flush();
    expect(loc()).toBe('/reports?status=pending');
  });
  it('ClickableCard: 중첩 a 없음, 빈 영역 이동, 내부 버튼은 이동 안 함', async () => {
    const onCopy = vi.fn();
    const h = mount(
      <ClickableCard to="/classes/1" label="카드"><CardAction><button type="button" onClick={onCopy}>복사</button></CardAction></ClickableCard>,
    );
    expect(h.querySelectorAll('a a')).toHaveLength(0);
    expect(h.querySelectorAll('a')).toHaveLength(1);
    h.querySelector('button')!.click();
    expect(onCopy).toHaveBeenCalled();
    expect(loc()).toBe('/');
    h.querySelector('a')!.click();
    await flush();
    expect(loc()).toBe('/classes/1');
  });
  const base: NotificationDto = { id: 'n1', type: 't', title: '알림', body: null, is_read: false, extra: { target_type: 'report', target_id: 'r1' }, created_at: '' };
  it('NotificationRow: 읽음 처리 후 이동', async () => {
    api.markRead.mockResolvedValue(undefined);
    const onRead = vi.fn();
    const h = mount(<NotificationRow notification={base} role="counselor" timeLabel="방금" onRead={onRead} />);
    h.querySelector('button')!.click();
    await flush();
    expect(api.markRead).toHaveBeenCalledWith('n1');
    expect(onRead).toHaveBeenCalledWith('n1');
    expect(loc()).toContain('/reports');
  });
  it('NotificationRow: 대상 없으면 읽음만, 읽음 실패해도 이동', async () => {
    api.markRead.mockResolvedValue(undefined);
    const h = mount(<NotificationRow notification={{ ...base, extra: null }} timeLabel="x" />);
    h.querySelector('button')!.click();
    await flush();
    expect(api.markRead).toHaveBeenCalled();
    expect(loc()).toBe('/');
    flushSync(() => root!.unmount()); host!.remove();
    api.markRead.mockRejectedValue(new Error('x'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h2 = mount(<NotificationRow notification={base} role="counselor" timeLabel="x" />);
    h2.querySelector('button')!.click();
    await flush();
    expect(loc()).toContain('/reports');
  });
});
