// SDD-209 H1 — 마법사 이탈 가드: 입력이 있으면 브라우저 이탈 확인 + 라우트 이탈을 자체 시트(blocker)로 처리한다.
// 마법사 안의 단계 이동은 라우트가 바뀌지 않으므로 가드에 걸리지 않는다. 생성 성공 후에는 bypass 로 이동한다.
import { useCallback, useRef } from 'react';
import type { Blocker } from 'react-router-dom';
import { useLeaveGuard } from './useLeaveGuard';

export interface WizardLeaveGuard {
  blocker: Blocker;
  /** 생성 완료 등 의도한 이동 직전에 호출해 가드를 끈다 */
  bypass: () => void;
}

export function useWizardLeaveGuard(dirty: boolean): WizardLeaveGuard {
  const bypassRef = useRef(false);
  const blocker = useLeaveGuard(() => dirty && !bypassRef.current);
  const bypass = useCallback(() => {
    bypassRef.current = true;
  }, []);
  return { blocker, bypass };
}
