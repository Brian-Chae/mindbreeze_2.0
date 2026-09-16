import { Navigate } from 'react-router-dom';

export default function ClientLoginPage() {
  return <Navigate to="/login?role=client" replace />;
}
