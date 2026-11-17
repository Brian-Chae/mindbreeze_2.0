// SDD-320 G — /playground 진입점(D안). 코치(counselor)는 D안 화면, 그 외 역할은 기존 화면을 그대로 쓴다.
import { useAuthStore } from '../../../stores/authStore';
import PlaygroundPage from '../PlaygroundPage';
import { UiV2CoachPlaygroundPage } from './ui-v2-coach-playground-page';

export function UiV2PlaygroundEntry() {
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'counselor' || role === 'org_admin') return <UiV2CoachPlaygroundPage />;
  // 11/9 대표 지시: 회원도 ui-v2 회원 셸로(내부 측정 패널은 동일)
  if (role === 'client') return <UiV2CoachPlaygroundPage member />;
  return <PlaygroundPage />;
}
