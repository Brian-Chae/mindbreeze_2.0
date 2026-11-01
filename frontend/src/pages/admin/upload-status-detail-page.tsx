// SDD-263: platform_admin 회차 상세 — 목록에서 진입. 같은 SDD-261 표 재사용.
import { Link, useParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { UploadStatusScreen } from '../../components/class/upload-status-screen';

export default function AdminUploadStatusDetailPage() {
  const { classId, sessionId } = useParams<{ classId: string; sessionId: string }>();
  return (
    <AppShell title="회차 데이터 현황" sub="ADMIN">
      <div className="mx-auto max-w-5xl space-y-4 text-[#2C2133]">
        <nav className="text-[13px] text-[#776D7B]"><Link className="underline" to="/admin/upload-status">데이터 현황</Link> › 회차 상세</nav>
        <UploadStatusScreen classId={classId ?? null} sessionId={sessionId ?? null} />
      </div>
    </AppShell>
  );
}
