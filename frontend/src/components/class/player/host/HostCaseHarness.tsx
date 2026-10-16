// SDD-208 — 케이스 하니스(/design/class-player)용 상담사 화면 래퍼. 픽스처 입력을 로컬 상태로 들고 있어 시안처럼 눌러 볼 수 있다.
// 서버·소켓·LiveKit 을 전혀 쓰지 않으므로 39개 케이스를 결정적으로 렌더·측정한다.
import { useMemo, useState } from 'react';
import { deriveHostCase, type HostCaseSpec } from '../../../../lib/class/host-player-case';
import type { PlayerCaseContext } from '../../../../lib/class/player-harness';
import { HostLiveView, type HostLiveActions } from './HostLiveView';
import { useHostUi } from './useHostUi';

interface HostCaseHarnessProps {
  spec: HostCaseSpec;
  ctx: PlayerCaseContext;
}

export function HostCaseHarness({ spec, ctx }: HostCaseHarnessProps) {
  const { ui, actions: uiActions } = useHostUi(spec.ui);
  const [participants] = useState(spec.input.participants);
  const hostCase = useMemo(
    () => deriveHostCase({ ...spec.input, participants, handsFirst: ui.handsFirst }),
    [spec.input, participants, ui.handsFirst],
  );
  const actions: HostLiveActions = useMemo(() => ({ close: () => undefined, end: () => undefined }), []);
  return (
    <HostLiveView
      hostCase={hostCase}
      participants={participants}
      ui={ui}
      uiActions={uiActions}
      meta={{ title: spec.meta.title, elapsedSec: spec.meta.elapsedSec, durationMin: spec.meta.durationMin }}
      unreadChat={spec.meta.unread}
      selfStream={null}
      actions={actions}
      backdropSrc={ctx.backdropSrc}
    />
  );
}
