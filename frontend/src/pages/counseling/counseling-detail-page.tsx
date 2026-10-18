import { useParams } from 'react-router-dom';
import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadStateView } from '../../components/class/structure/read-state';
import { CounselingDetailView } from '../../components/class/structure/counseling-views';
import { useCounselingDetail } from '../../hooks/use-class-structure';
import { adaptCounseling } from '../../lib/class-structure/adapters';
import { counselingListPath } from '../../lib/class-structure/navigation';
import { asRelationshipId, type StructureRole } from '../../lib/class-structure/read-model';

function DetailBody({ role, relationshipId }: { role: StructureRole; relationshipId: string }) {
  const { state, retry } = useCounselingDetail(asRelationshipId(relationshipId));
  return (
    <ReadStateView status={state.status} area="counseling" backTo={counselingListPath(role)} onRetry={retry}>
      {state.status === 'success' && <CounselingDetailView role={role} model={adaptCounseling(state.data)} />}
    </ReadStateView>
  );
}

export function CounselingDetailPage({ role }: { role: StructureRole }) {
  const { relationshipId } = useParams<{ relationshipId: string }>();
  return (
    <StructureShell role={role} area="counseling" title={role === 'member' ? '내 상담' : '상담'}>
      {relationshipId?.trim()
        ? <DetailBody role={role} relationshipId={relationshipId} />
        : <ReadStateView status="not_found" area="counseling" backTo={counselingListPath(role)} />}
    </StructureShell>
  );
}

export default CounselingDetailPage;
