// SDD-320 G — /playground 진입점(D안). 코치(counselor)는 D안 화면, 그 외 역할은 기존 화면을 그대로 쓴다.
import { useAuthStore } from '../../../stores/authStore';
import PlaygroundPage from '../PlaygroundPage';
import { UiV2CoachPlaygroundPage } from './ui-v2-coach-playground-page';

export function UiV2PlaygroundEntry() {
  const role = useAuthStore((s) => s.user?.role);
  return role === 'counselor' ? <UiV2CoachPlaygroundPage /> : <PlaygroundPage />;
}
