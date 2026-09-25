import { useState } from 'react';

function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 저장이 차단되어도 현재 화면에서는 적용한다. */ }
}

export function useChatSortPreference() {
  const [unreadFirst, setUnreadFirst] = useState(() => readPreference('mb.chat.unreadFirst') === 'true');
  return {
    unreadFirst,
    onUnreadFirstChange: (value: boolean) => {
      setUnreadFirst(value);
      writePreference('mb.chat.unreadFirst', String(value));
    },
  };
}
