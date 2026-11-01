// SDD-262: 회원 설정 > 내 데이터 저장 현황 (/app/profile/upload-status)
import { Link } from 'react-router-dom';
import ClientShell from '../../components/client/ClientShell';
import { MyUploadStatusScreen } from '../../components/client/my-upload-status-screen';

export default function MyUploadStatusPage() {
  return <ClientShell title="내 데이터 저장 현황" sub="SETTINGS">
    <nav className="mb-3 text-[13px] text-[#776D7B]"><Link className="inline-flex min-h-11 items-center underline" to="/app/profile">설정</Link> › 내 데이터 저장 현황</nav>
    <MyUploadStatusScreen />
  </ClientShell>;
}
