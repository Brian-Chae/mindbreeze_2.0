// 알림 센터 페이지

import { useEffect, useState, useCallback } from 'react';
import AppShell from '../../components/layout/AppShell';
import {
  listNotifications,
  markRead,
  markAllRead,
  getPreferences,
  updatePreferences,
  type NotificationDto,
  type NotificationPreferencesResponse,
} from '../../lib/api/notifications';

const TYPE_ICONS: Record<string, string> = {
  session: '📅',
  chat: '💬',
  report: '📄',
  verification: '✅',
  system: '🔔',
};

const TYPE_LABELS: Record<string, string> = {
  session: '세션',
  chat: '채팅',
  report: '리포트',
  verification: '검증',
  system: '시스템',
};

const EVENT_LABELS: Record<string, string> = {
  session_booked: '세션 예약',
  session_updated: '세션 변경',
  session_cancelled: '세션 취소',
  chat_message: '채팅 메시지',
  report_ready: '리포트 발행',
  verification_result: '검증 결과',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

function NotificationCard({
  notification,
  onClick,
}: {
  notification: NotificationDto;
  onClick: () => void;
}) {
  const icon = TYPE_ICONS[notification.type] ?? '🔔';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white border border-[#EFEFEF] rounded-2xl p-4 hover:shadow-sm transition-all ${
        !notification.is_read ? 'border-l-[3px] border-l-[#5F0080]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-[20px] mt-0.5 shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span
              className={`text-[14px] ${notification.is_read ? 'text-[#1F1F1F] font-medium' : 'text-[#1F1F1F] font-bold'}`}
            >
              {notification.title}
            </span>
            <span className="text-[11px] text-[#9B9B9B] font-mono shrink-0">
              {timeAgo(notification.created_at)}
            </span>
          </div>
          {notification.body && (
            <div className="text-[13px] text-[#6F6F6F] line-clamp-2">{notification.body}</div>
          )}
          <div className="mt-1.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F5EDFC] text-[#5F0080]">
              {TYPE_LABELS[notification.type] ?? notification.type}
            </span>
          </div>
        </div>
        {!notification.is_read && (
          <div className="w-2 h-2 rounded-full bg-[#5F0080] shrink-0 mt-1.5" />
        )}
      </div>
    </button>
  );
}

export default function NotificationCenterPage() {
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await listNotifications(false, 50, 0);
      setNotifications(res.notifications);
    } catch (e) {
      setError(e instanceof Error ? e.message : '알림 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPrefs = useCallback(async () => {
    try {
      const p = await getPreferences();
      setPrefs(p);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (showPreferences) fetchPrefs();
  }, [showPreferences, fetchPrefs]);

  const handleClick = useCallback(
    async (n: NotificationDto) => {
      if (!n.is_read) {
        try {
          await markRead(n.id);
          setNotifications((prev) =>
            prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)),
          );
        } catch {
          // ignore
        }
      }
    },
    [],
  );

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllRead();
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : '전체 읽음 처리 실패');
    }
  }, []);

  const handleTogglePref = useCallback(
    async (channel: 'email' | 'in_app', event: string) => {
      if (!prefs) return;
      const updated = {
        ...prefs,
        [channel]: { ...prefs[channel], [event]: !prefs[channel][event] },
      };
      try {
        const result = await updatePreferences(updated);
        setPrefs(result);
      } catch {
        // ignore
      }
    },
    [prefs],
  );

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <AppShell title="알림" sub="NOTIFICATIONS">
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* 상단 바 */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-[13px] text-[#6F6F6F]">
            {unreadCount > 0 ? `읽지 않은 알림 ${unreadCount}개` : '모든 알림을 읽었습니다'}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[13px] font-medium text-[#5F0080] hover:underline"
              >
                전체 읽음
              </button>
            )}
            <button
              onClick={() => setShowPreferences(!showPreferences)}
              className="text-[13px] font-medium text-[#6F6F6F] hover:text-[#1F1F1F]"
            >
              {showPreferences ? '닫기' : '설정'}
            </button>
          </div>
        </div>

        {/* 환경설정 패널 */}
        {showPreferences && prefs && (
          <div className="bg-[#F8FAFC] border border-[#EFEFEF] rounded-2xl p-5 mb-6">
            <h3 className="text-[14px] font-bold text-[#1F1F1F] mb-4">메일 알림 설정</h3>
            <div className="space-y-4">
              {(['email', 'in_app'] as const).map((channel) => (
                <div key={channel}>
                  <div className="text-[12px] font-bold text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">
                    {channel === 'email' ? '이메일' : '인앱'}
                  </div>
                  <div className="space-y-2">
                    {Object.entries(prefs[channel]).map(([event, enabled]) => (
                      <label
                        key={event}
                        className="flex items-center justify-between py-2 px-3 bg-white rounded-xl border border-[#EFEFEF] cursor-pointer"
                      >
                        <span className="text-[13px] text-[#1F1F1F]">
                          {EVENT_LABELS[event] ?? event}
                        </span>
                        <button
                          onClick={() => handleTogglePref(channel, event)}
                          className={`relative w-10 h-6 rounded-full transition-colors ${
                            enabled ? 'bg-[#5F0080]' : 'bg-[#DDDEE7]'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                              enabled ? 'left-[18px]' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 알림 목록 */}
        {loading ? (
          <div className="text-[#6F6F6F]">불러오는 중...</div>
        ) : notifications.length === 0 ? (
          <div className="border border-dashed border-[#DDDEE7] rounded-2xl p-12 text-center">
            <div className="text-[40px] mb-3">🔔</div>
            <div className="text-[#6F6F6F] text-sm">아직 알림이 없습니다.</div>
            <div className="text-[#9B9B9B] text-xs mt-1">
              세션·채팅·리포트 관련 알림이 여기에 표시됩니다.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <NotificationCard key={n.id} notification={n} onClick={() => handleClick(n)} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
