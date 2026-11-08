// SDD-320 G — 코치 알림(D안, 시안 notifications.html). 목록 50건·읽음·전체 읽음·딥링크·설정(이메일/인앱 토글)은 기관 D안·구버전과 같은 API·훅을 그대로 쓴다.
// 시안의 탭(전체/회차/리포트)은 알림 유형으로 거르는 화면 필터이며, 대화 알림은 '대화' 탭으로 둔다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../../../components/layout/AppShell';
import { eventLabel } from '../../../lib/notification-format';
import { getPreferences, updatePreferences, type NotificationPreferencesResponse } from '../../../lib/api/notifications';
import { useAuthStore } from '../../../stores/authStore';
import { useUiV2Notifications } from './use-ui-v2-notifications';
import { UiV2NotificationError, UiV2NotificationList, UiV2NotificationRow } from './ui-v2-notification-parts';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-pc.css';
import '../../../styles/ui-v2-coach-noti-pg.css';

type NotiTab = 'all' | 'session' | 'report' | 'chat';
const TABS: { key: NotiTab; label: string }[] = [
  { key: 'all', label: '전체' }, { key: 'session', label: '회차' }, { key: 'report', label: '리포트' }, { key: 'chat', label: '대화' },
];

export function UiV2CoachNotificationsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const state = useUiV2Notifications({ role, loadErrorMessage: '알림 조회 실패', markAllErrorMessage: '전체 읽음 처리 실패' });
  const { setError } = state;
  const [tab, setTab] = useState<NotiTab>('all');
  const [showPreferences, setShowPreferences] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    setPrefsError(null);
    try { setPrefs(await getPreferences()); }
    catch (e) { setPrefsError(e instanceof Error ? e.message : '알림 설정을 불러오지 못했습니다'); }
  }, []);
  useEffect(() => { if (showPreferences) void fetchPrefs(); }, [showPreferences, fetchPrefs]);

  // 낙관적 업데이트 — 실패하면 이전 설정으로 되돌리고 사용자에게 알린다.
  const toggle = useCallback(async (channel: 'email' | 'in_app', event: string) => {
    if (!prefs) return;
    const previous = prefs;
    const next = { ...prefs, [channel]: { ...prefs[channel], [event]: !prefs[channel][event] } };
    setError(null);
    setPrefs(next);
    try { setPrefs(await updatePreferences(next)); }
    catch (e) { setPrefs(previous); setError(e instanceof Error ? e.message : '알림 설정 저장에 실패했습니다'); }
  }, [prefs, setError]);

  const visible = useMemo(() => state.notifications.filter((n) => tab === 'all' || n.type === tab), [state.notifications, tab]);
  const summary = state.loading ? '' : state.unreadCount > 0 ? `읽지 않은 알림 ${state.unreadCount}개` : '모든 알림을 읽었습니다';

  return (
    <AppShell title="필요한 소식만 모았어요">
      <div className="ui-v2 u2f u2g-noti">
        <div className="u2g-bar">
          <p className="u2f-lead" aria-live="polite">{summary}</p>
          <div className="u2g-actions">
            {state.unreadCount > 0 && <button type="button" className="u2-secondary" onClick={() => void state.markAll()} disabled={state.markingAll}>전체 읽음</button>}
            <button type="button" className="u2-secondary" aria-expanded={showPreferences} onClick={() => setShowPreferences((value) => !value)}>{showPreferences ? '닫기' : '설정'}</button>
          </div>
        </div>
        <div className="u2f-chips" role="group" aria-label="알림 유형">
          {TABS.map((t) => <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>
        {state.error && <UiV2NotificationError message={state.error} />}
        <div className="u2-notif-wrap u2g-wrap">
          {showPreferences && prefsError && (
            <div role="alert" className="u2-card u2-notif-prefs">
              <h2>알림 설정을 불러오지 못했습니다</h2>
              <p className="u2-error">{prefsError}</p>
              <button type="button" className="u2-secondary" onClick={() => void fetchPrefs()}>다시 시도</button>
            </div>
          )}
          {showPreferences && !prefsError && !prefs && <div className="u2-card u2-notif-prefs"><p>알림 설정을 불러오는 중...</p></div>}
          {showPreferences && !prefsError && prefs && (
            <section className="u2-card u2-notif-prefs" aria-labelledby="u2g-prefs-title">
              <h2 id="u2g-prefs-title">메일 알림 설정</h2>
              {(['email', 'in_app'] as const).map((channel) => (
                <div key={channel} className="u2-notif-prefgroup">
                  <h3>{channel === 'email' ? '이메일' : '인앱'}</h3>
                  <ul>
                    {Object.entries(prefs[channel]).map(([event, enabled]) => (
                      <li key={event} className="u2-notif-pref">
                        <span>{eventLabel(event)}</span>
                        <button type="button" role="switch" aria-checked={enabled} aria-label={`${eventLabel(event)} ${channel === 'email' ? '이메일' : '인앱'} 알림`} className="u2-notif-switch" onClick={() => void toggle(channel, event)}>
                          <span className="u2-notif-track" aria-hidden="true"><span className="u2-notif-thumb" /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          <UiV2NotificationList loading={state.loading} empty={visible.length === 0}>
            {visible.map((notification) => (
              <UiV2NotificationRow key={notification.id} notification={notification} onOpen={() => void state.open(notification)} />
            ))}
          </UiV2NotificationList>
        </div>
      </div>
    </AppShell>
  );
}
