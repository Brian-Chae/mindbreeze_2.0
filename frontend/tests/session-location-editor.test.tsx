// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionLocationEditor } from '../src/components/session/session-location-editor';
import { updateSession, type SessionDto } from '../src/lib/api/session';

vi.mock('../src/lib/api/session', () => ({ updateSession: vi.fn() }));
const session: SessionDto = {
  id: 'session-1', type: 'clinical', custom_type_name: null, status: 'scheduled',
  host_id: 'host-1', scheduled_at: null, access_code: null, started_at: null, ended_at: null,
  duration_min: 50, title: '상담', notes: null, max_participants: 1,
  location_type: 'offline', location_address: '서버가 채운 주소', participant_mode: 'one_on_one',
  linkband_mode: 'optional', webrtc_room_id: null, sfu_enabled: false,
  record_audio: false, record_video: false, created_at: '', participants: [], waitlist_count: 0,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(updateSession).mockResolvedValue(session);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

it('서버 주소를 표시하고 수정한 주소를 저장한다', async () => {
  const onSaved = vi.fn();
  await act(async () => root.render(<SessionLocationEditor session={session} onSaved={onSaved} onCancel={vi.fn()} />));
  const input = container.querySelector('input')!;
  expect(input.value).toBe('서버가 채운 주소');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '새 상담 장소');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(updateSession).toHaveBeenCalledWith('session-1', { location_type: 'offline', location_address: '새 상담 장소' });
  expect(onSaved).toHaveBeenCalledWith(session);
});

it('온라인으로 바꾸면 주소를 숨기고 저장 요청에서 생략한다', async () => {
  await act(async () => root.render(<SessionLocationEditor session={session} onSaved={vi.fn()} onCancel={vi.fn()} />));
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = 'online';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.querySelector('input')).toBeNull();
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(updateSession).toHaveBeenCalledWith('session-1', { location_type: 'online', location_address: undefined });
});
