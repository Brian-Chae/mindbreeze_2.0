// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { requestWaitingRoomReminder, type WaitingRoomReminderAck } from '../src/lib/socket';

it('리마인드는 timeout과 서버 거절을 실패로 전달한다', async () => {
  const timeout = vi.fn();
  const socket = { connected: true, timeout };
  timeout.mockReturnValue({ emit: (_event: string, _payload: unknown, ack: (error: Error | null, result?: WaitingRoomReminderAck) => void) => ack(new Error('timeout')) });
  await expect(requestWaitingRoomReminder(socket as unknown as Socket, 's1', ['p1'])).rejects.toThrow('안내를 보내지 못했어요');
  expect(timeout).toHaveBeenCalledWith(5000);
  timeout.mockReturnValue({ emit: (_event: string, _payload: unknown, ack: (error: Error | null, result?: WaitingRoomReminderAck) => void) => ack(null, { ok: false, error: '권한 없음' }) });
  await expect(requestWaitingRoomReminder(socket as unknown as Socket, 's1', ['p1'])).rejects.toThrow('권한 없음');
  socket.connected = false;
  await expect(requestWaitingRoomReminder(socket as unknown as Socket, 's1', ['p1'])).rejects.toThrow('연결이 끊겼어요');
});

it('리마인드 ack 수락 시 실제 서버 응답을 반환한다', async () => {
  const emit = vi.fn((_event: string, _payload: unknown, ack: (error: Error | null, result: WaitingRoomReminderAck) => void) => ack(null, { ok: true, sent: 2 }));
  const socket = { connected: true, timeout: () => ({ emit }) };
  await expect(requestWaitingRoomReminder(socket as unknown as Socket, 's1', ['p1', 'p2'])).resolves.toEqual({ ok: true, sent: 2 });
  expect(emit).toHaveBeenCalledWith('waiting_room_remind', { session_id: 's1', participant_ids: ['p1', 'p2'] }, expect.any(Function));
});
