// SDD-335 — 측정 중 뒤로가기·화면 이동 확인. useBlocker 는 데이터 라우터 전용이라 이 컴포넌트는 데이터 라우터 안에서만 렌더한다.
import { useContext } from 'react';
import { UNSAFE_DataRouterContext } from 'react-router-dom';
import { useLeaveGuard } from '../../../../hooks/useLeaveGuard';
import { LeaveConfirmModal } from '../../../player/LeaveConfirmModal';

interface Props {
  /** 이탈 시점에 평가 — 측정 중이고 확정 이탈이 아닐 때 true */
  shouldGuard: () => boolean;
}

function Guard({ shouldGuard }: Props) {
  const blocker = useLeaveGuard(shouldGuard);
  return <LeaveConfirmModal open={blocker.state === 'blocked'} onConfirm={() => blocker.proceed?.()} onCancel={() => blocker.reset?.()} />;
}

/** 데이터 라우터가 아니면(단위 테스트의 MemoryRouter 등) 아무것도 하지 않는다. */
export function MeasuringLeaveGuard(props: Props) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return dataRouter ? <Guard {...props} /> : null;
}
