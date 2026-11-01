// SDD-261: 설정 > 데이터 저장·업로드 현황 (counselor/org_admin)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { UploadStatusPicker } from '../../components/class/upload-status-picker';
import { UploadStatusScreen } from '../../components/class/upload-status-screen';

export default function SettingsUploadStatusPage() {
  const [sel, setSel] = useState<{ classId: string | null; sessionId: string | null }>({ classId: null, sessionId: null });
  return (
    <AppShell title="데이터 저장·업로드 현황" sub="SETTINGS">
      <div className="mx-auto max-w-5xl space-y-4 text-[#2C2133]">
        <nav className="text-[13px] text-[#776D7B]"><Link className="underline" to="/settings">설정</Link> › 데이터 저장·업로드 현황</nav>
        <UploadStatusPicker mode="member" onChange={setSel} />
        <UploadStatusScreen classId={sel.classId} sessionId={sel.sessionId} />
      </div>
    </AppShell>
  );
}
