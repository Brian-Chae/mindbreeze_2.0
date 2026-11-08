// SDD-322 — 내담자 알림(D안). 목록·읽음·전체 읽음·딥링크·본문 펼침은 구버전(ClientNotificationPage)과 같은 규칙이고 쉘·마크업만 D안이다.
import { UiV2ClientShell } from '../../../components/ui-v2/ui-v2-client-shell';
import { useUiV2Notifications } from '../../notifications/ui-v2/use-ui-v2-notifications';
import { UiV2NotificationError, UiV2NotificationList, UiV2NotificationRow } from '../../notifications/ui-v2/ui-v2-notification-parts';

export function UiV2NotificationsPage() {
  const state = useUiV2Notifications({
    role: 'client',
    expandWhenNoTarget: true,
    surfaceReadError: true,
    loadErrorMessage: '알림을 불러오지 못했습니다. 다시 시도해 주세요.',
    markAllErrorMessage: '전체 읽음 처리에 실패했습니다. 다시 시도해 주세요.',
  });
  return (
    <UiV2ClientShell title="알림" subtitle="클래스·대화·리포트 소식을 한곳에서 확인해요.">
      <div className="u2-notif-bar">
        <small aria-live="polite">{state.loading ? '' : state.unreadCount > 0 ? `읽지 않은 알림 ${state.unreadCount}개` : '모든 알림을 읽었습니다'}</small>
        <button type="button" className="u2-textlink" onClick={() => void state.markAll()} disabled={state.loading || state.markingAll}>전체 읽음</button>
      </div>
      {state.error && <UiV2NotificationError message={state.error} onRetry={state.retry} />}
      <UiV2NotificationList loading={state.loading} empty={state.notifications.length === 0} hideEmpty={!!state.error}>
        {state.notifications.map((notification) => (
          <UiV2NotificationRow key={notification.id} notification={notification} onOpen={() => void state.open(notification)} expanded={state.expandedId === notification.id} />
        ))}
      </UiV2NotificationList>
    </UiV2ClientShell>
  );
}
