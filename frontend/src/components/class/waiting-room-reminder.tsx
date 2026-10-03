import { useEffect, useState } from 'react';
import { tokenStorage } from '../../lib/api/client';
import { getSessionLiveSocket, type WaitingRoomReminderEvent } from '../../lib/socket';

export function WaitingRoomReminder({ sessionId, skipAuth = false }: { sessionId: string; skipAuth?: boolean }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const socket = getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess());
    const onReminder = (event: WaitingRoomReminderEvent) => {
      if (event.session_id === sessionId && typeof event.message === 'string') setMessage(event.message);
    };
    socket.on('waiting_room_reminder', onReminder);
    return () => { socket.off('waiting_room_reminder', onReminder); };
  }, [sessionId, skipAuth]);
  return message ? <p role="status" className="rounded-xl border border-[#dcb5ee]/30 bg-[#dcb5ee]/10 p-4 text-sm text-[#dcb5ee]">{message}</p> : null;
}
