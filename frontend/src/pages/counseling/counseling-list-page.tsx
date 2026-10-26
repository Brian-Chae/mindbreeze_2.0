import { StructureShell } from '../../components/class/structure/structure-shell';
import { ReadStateView } from '../../components/class/structure/read-state';
import { CounselingList } from '../../components/class/structure/counseling-views';
import { useCounseling } from '../../hooks/use-class-structure';
import { adaptCounseling } from '../../lib/class-structure/adapters';
import { counselingListPath } from '../../lib/class-structure/navigation';
import type { StructureRole } from '../../lib/class-structure/read-model';

export function CounselingListPage({ role }: { role: StructureRole }) {
  const { state, retry } = useCounseling();
  const rows = state.status === 'success' ? state.data.relationships.map(adaptCounseling) : [];
  const status = state.status === 'success' && rows.length === 0 ? 'empty' : state.status;
  return (
    <StructureShell role={role} area="counseling" title={role === 'member' ? '내 상담' : '상담'}>
      <ReadStateView status={status} area="counseling" backTo={counselingListPath(role)} onRetry={retry}>
        <CounselingList role={role} rows={rows} />
      </ReadStateView>
    </StructureShell>
  );
}

export default CounselingListPage;
