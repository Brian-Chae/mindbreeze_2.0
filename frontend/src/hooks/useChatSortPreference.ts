import { useState } from 'react';
import type { ChatSortMode } from '../lib/chat-sort';

function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 저장이 차단되어도 현재 화면에서는 적용한다. */ }
}

export function useChatSortPreference() {
  const [mode, setMode] = useState<ChatSortMode>(() =>
    readPreference('mb.chat.sort') === 'recent_session' ? 'recent_session' : 'recent_message');
  const [unreadFirst, setUnreadFirst] = useState(() => readPreference('mb.chat.unreadFirst') === 'true');
  return {
    mode, unreadFirst,
    onModeChange: (value: ChatSortMode) => {
      setMode(value);
      writePreference('mb.chat.sort', value);
    },
    onUnreadFirstChange: (value: boolean) => {
      setUnreadFirst(value);
      writePreference('mb.chat.unreadFirst', String(value));
    },
  };
}
