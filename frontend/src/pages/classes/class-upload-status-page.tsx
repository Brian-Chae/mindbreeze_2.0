// SDD-261/265: 코치 클래스 관리 > 회차 데이터 현황 (클래스·회차 고정)
import { Link, useParams } from 'react-router-dom';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { UploadStatusScreen } from '../../components/class/upload-status-screen';

export default function ClassUploadStatusPage() {
  const { classId, sessionId } = useParams<{ classId: string; sessionId: string }>();
  return (
    <StructureShell role="host" title="회차 데이터 현황" rightSlot={classId ? <Link className="text-[#5B1A8A] underline" to={`/classes/${encodeURIComponent(classId)}/sessions`}>회차 목록</Link> : undefined}>
      <div className="mx-auto max-w-mb-content space-y-4 pb-6 text-[#2C2133]">
        <UploadStatusScreen classId={classId ?? null} sessionId={sessionId ?? null} />
      </div>
    </StructureShell>
  );
}
