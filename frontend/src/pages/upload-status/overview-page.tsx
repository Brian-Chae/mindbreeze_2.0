// SDD-263: 데이터 현황 — 전체 회차 목록 (counselor/org_admin: /upload-status, platform_admin: /admin/upload-status)
import AppShell from '../../components/layout/AppShell';
import { UploadOverviewScreen } from '../../components/class/upload-overview-screen';

export default function UploadOverviewPage({ platform = false }: { platform?: boolean }) {
  return (
    <AppShell title="데이터 현황" sub={platform ? 'ADMIN' : 'DATA'}>
      <div className="mx-auto max-w-6xl space-y-4 text-[#2C2133]">
        <p className="text-[14px] text-[#776D7B]">최근 회차의 데이터가 서버에 얼마나 도착했는지 숫자로 보여 줘요. 확인할 곳이 먼저 나와요.</p>
        <UploadOverviewScreen platform={platform} />
      </div>
    </AppShell>
  );
}
