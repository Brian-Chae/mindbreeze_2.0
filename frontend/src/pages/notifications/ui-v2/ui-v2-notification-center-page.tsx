// SDD-322 — /notifications 진입점(D안). 기관관리자는 D안 쉘 화면, 그 외(코치·플랫폼 관리자)는 기존 화면을 그대로 쓴다(코치는 u2-coach 스킨으로 D안 적용).
import { useAuthStore } from '../../../stores/authStore';
import NotificationCenterPage from '../NotificationCenterPage';
import { UiV2OrgNotificationsPage } from './ui-v2-org-notifications-page';

export function UiV2NotificationCenterPage() {
  const role = useAuthStore((s) => s.user?.role);
  return role === 'org_admin' ? <UiV2OrgNotificationsPage /> : <NotificationCenterPage />;
}
