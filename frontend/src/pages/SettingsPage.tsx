import { Navigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import SettingsContent from '../components/settings/settings-content';
import { useAuthStore } from '../stores/authStore';
export default function SettingsPage() {
  const role = useAuthStore(s => s.user?.role);
  if (role === 'client') return <Navigate to="/app/profile" replace />;
  return <AppShell title="설정" sub="SETTINGS"><SettingsContent /></AppShell>;
}
