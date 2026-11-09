// SDD-322 — /notifications 진입점(D안). 기관관리자·코치는 D안 화면, 그 외(플랫폼 관리자)는 기존 화면을 그대로 쓴다.
import { useAuthStore } from '../../../stores/authStore';
import NotificationCenterPage from '../NotificationCenterPage';
import { UiV2CoachNotificationsPage } from './ui-v2-coach-notifications-page';
import { UiV2OrgNotificationsPage } from './ui-v2-org-notifications-page';

export function UiV2NotificationCenterPage() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'org_admin') return <UiV2OrgNotificationsPage />;
  if (role === 'counselor') return <UiV2CoachNotificationsPage />;
  return <NotificationCenterPage />;
}
