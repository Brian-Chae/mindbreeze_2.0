// 클래스 목록 페이지 (SDD-209 FH01) — 열린 클래스 상단 고정 + 예정/지난 카드 목록.
// 예약 만들기 모달은 없다: 클래스 만들기가 `/sessions/new` 마법사로 가는 유일한 진입점이다.
// 캘린더·타임라인·표는 없다(D-5② 확정).

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { transitionSession } from '../../lib/api/session';
import { useClassList } from '../../hooks/useClassList';
import AppShell from '../../components/layout/AppShell';
import { ClassActionSheet } from '../../components/class/flow/shell/ClassActionSheet';
import { HostClassListView, type HostPlayerIntent } from '../../components/class/flow/shell/HostClassListView';
import { buildHostListModel, type HostListTab } from '../../components/class/flow/shell/host-shell-data';
import '../../components/class/flow/shell/shell-kit.css';

const NET_NOTICE = '연결이 끊겼어요. 다시 연결되면 자동으로 새로 고쳐요.';

export default function SessionListPage() {
  const navigate = useNavigate();
  const { sessions, loading, error, stale, refresh } = useClassList();
  const [tab, setTab] = useState<HostListTab>('upcoming');
  const [closeTargetId, setCloseTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const model = useMemo(() => buildHostListModel(sessions, tab), [sessions, tab]);
  const closeTarget = closeTargetId ? sessions.find((s) => s.id === closeTargetId) ?? null : null;

  // 시작하기·이어서 열기는 모두 플레이어(로비)로 간다. 시작은 로비의 시작 확인 시트(FH07)를 거치므로 목록에서 바로 시작하지 않는다.
  const enterPlayer = useCallback((id: string, intent: HostPlayerIntent): void => {
    navigate(`/sessions/${id}/player`, intent === 'start' ? { state: { intent: 'start' } } : undefined);
  }, [navigate]);

  const confirmClose = useCallback(async (): Promise<void> => {
    if (!closeTargetId) return;
    setBusy(true);
    setActionError(null);
    try {
      await transitionSession(closeTargetId, 'cancel');
      setCloseTargetId(null);
      await refresh();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : '클래스를 닫지 못했어요');
    } finally {
      setBusy(false);
    }
  }, [closeTargetId, refresh]);

  const rightSlot = (
    <button data-header-action="primary" type="button" onClick={() => navigate('/sessions/new')} className="mb-btn">
      <Plus size={20} aria-hidden="true" />클래스 만들기
    </button>
  );

  return (
    <AppShell title="클래스" rightSlot={rightSlot} noScroll>
      <div className="sh-scope mx-auto h-full w-full max-w-mb-content overflow-y-auto pb-6">
        <div className="sh-col">
          {loading ? (
            <p className="py-8 text-center text-sm text-[#6F6F6F]">불러오는 중...</p>
          ) : error ? (
            <div role="alert" className="py-8 text-center">
              <p className="text-sm text-[#B3261E]">{error}</p>
              <button type="button" className="sh-btn line mt-4" onClick={() => void refresh()}>다시 시도</button>
            </div>
          ) : (
            <HostClassListView
              model={model}
              tab={tab}
              onTab={setTab}
              onCreate={() => navigate('/sessions/new')}
              onDetail={(id) => navigate(`/sessions/${id}`)}
              onEnterPlayer={enterPlayer}
              onRequestClose={setCloseTargetId}
              notice={stale ? NET_NOTICE : null}
            />
          )}
        </div>
      </div>
      {closeTarget ? (
        <ClassActionSheet
          kind="close"
          count={closeTarget.participants.length}
          busy={busy}
          error={actionError}
          onConfirm={() => void confirmClose()}
          onClose={() => { setCloseTargetId(null); setActionError(null); }}
        />
      ) : null}
    </AppShell>
  );
}
