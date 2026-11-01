// SDD-263: 데이터 현황 — 전체 회차 목록 (counselor/org_admin: /upload-status, platform_admin: /admin/upload-status)
import AppShell from '../../components/layout/AppShell';
import { UploadOverviewScreen } from '../../components/class/upload-overview-screen';

export default function UploadOverviewPage({ platform = false }: { platform?: boolean }) {
  return (
    <AppShell title="데이터 현황" sub={platform ? 'ADMIN' : 'DATA'}>
      <div className="mx-auto max-w-6xl space-y-4 text-[#2C2133]">
        <p className="text-[14px] text-[#776D7B]">내가 볼 수 있는 회차의 서버 수신 현황이에요. 회차를 누르면 참여자별 상세를 볼 수 있어요.</p>
        <UploadOverviewScreen platform={platform} />
      </div>
    </AppShell>
  );
}
