// 알림 센터 페이지

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotificationCard, EVENT_LABELS } from '../../components/notifications/NotificationCard';
import AppShell from '../../components/layout/AppShell';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import {
  listNotifications,
  markRead,
  markAllRead,
  getPreferences,
  updatePreferences,
  resolveNotificationTarget,
  type NotificationDto,
  type NotificationPreferencesResponse,
} from '../../lib/api/notifications';

export default function NotificationCenterPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);

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
    setPrefsError(null);
    try {
      const p = await getPreferences();
      setPrefs(p);
    } catch (e) {
      setPrefsError(e instanceof Error ? e.message : '알림 설정을 불러오지 못했습니다');
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
          // NOTIF-01: 상단 헤더·사이드바 배지는 전역 unread 를 쓴다 — 읽음 처리 후 재조회한다.
          void useNotificationStore.getState().fetch();
        } catch {
          // 읽음 저장 실패해도 이동은 허용
        }
      }
      // SDD-093: 알림 클릭 → 딥링크 후속 행위 (이동 불가면 알림 센터 유지)
      const target = resolveNotificationTarget(n.extra, user?.role);
      if (target) {
        navigate(target.path);
      }
    },
    [navigate, user?.role],
  );

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllRead();
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
      // NOTIF-01: 전체 읽음 처리 후에도 전역 배지를 즉시 갱신한다.
      void useNotificationStore.getState().fetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : '전체 읽음 처리 실패');
    }
  }, []);

  // 낙관적 업데이트 — 실패하면 이전 설정으로 되돌리고 사용자에게 알린다.
  const handleTogglePref = useCallback(
    async (channel: 'email' | 'in_app', event: string) => {
      if (!prefs) return;
      const prevPrefs = prefs;
      const updated = {
        ...prefs,
        [channel]: { ...prefs[channel], [event]: !prefs[channel][event] },
      };
      setError(null);
      setPrefs(updated);
      try {
        const result = await updatePreferences(updated);
        setPrefs(result);
      } catch (e) {
        setPrefs(prevPrefs);
        setError(e instanceof Error ? e.message : '알림 설정 저장에 실패했습니다');
      }
    },
    [prefs],
  );

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <AppShell title="알림" sub="NOTIFICATIONS">
      {error && (
        <div role="alert" className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
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
        {showPreferences && prefsError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6" role="alert">
            <p className="text-sm text-red-700 mb-1">알림 설정을 불러오지 못했습니다</p>
            <p className="text-[12px] text-red-600 mb-3">{prefsError}</p>
            <button
              type="button"
              onClick={() => void fetchPrefs()}
              className="rounded-lg px-3 py-1.5 text-[13px] font-semibold bg-white text-[#1F1F1F] border border-[#EFEFEF] hover:bg-[#F5F5F5] transition-colors"
            >
              다시 시도
            </button>
          </div>
        )}

        {showPreferences && !prefsError && !prefs && (
          <div className="bg-[#F8FAFC] border border-[#EFEFEF] rounded-2xl p-5 mb-6 text-[13px] text-[#6F6F6F]">
            알림 설정을 불러오는 중...
          </div>
        )}

        {showPreferences && !prefsError && prefs && (
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
                        <span className="-m-2.5 inline-flex shrink-0 items-center p-2.5">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={enabled}
                            aria-label={`${EVENT_LABELS[event] ?? event} ${channel === 'email' ? '이메일' : '인앱'} 알림`}
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
                        </span>
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
