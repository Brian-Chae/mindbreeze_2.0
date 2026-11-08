// SDD-321 — 기관 D안 공용 소품: 상태 칩, 대화상자(useDialogA11y 재사용), 통계 칸.
import type { ReactNode } from 'react';
import { useDialogA11y } from '../../../hooks/useDialogA11y';
import { sessionStatusLabel } from '../../../lib/session-status';
import type { SessionStatus } from '../../../lib/api/session';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-org.css';

export type PillTone = 'ok' | 'warn' | 'danger' | 'info' | 'accent' | 'neutral';

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`u2-pill u2-pill--${tone}`}>{children}</span>;
}

const SESSION_TONE: Record<SessionStatus, PillTone> = {
  ready: 'info',
  scheduled: 'accent',
  open: 'ok',
  in_progress: 'ok',
  completed: 'neutral',
  cancelled: 'danger',
};

/** 클래스 상태 칩 — 라벨은 공용 단일 출처(sessionStatusLabel)를 그대로 쓴다. */
export function SessionStatusPill({ status }: { status: SessionStatus }) {
  return <Pill tone={SESSION_TONE[status] ?? 'neutral'}>{sessionStatusLabel(status)}</Pill>;
}

export function StatCell({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="u2-org-stat">
      <dt>{label}</dt>
      <dd className={accent ? 'u2-accent' : undefined}>{typeof value === 'number' ? value.toLocaleString('ko-KR') : value}</dd>
    </div>
  );
}

/** 오버레이 대화상자. 포커스 트랩·ESC·포커스 복원은 기존 useDialogA11y 가 맡는다. 오버레이는 .ui-v2 안에 그려 스코프 CSS 를 받는다. */
export function OrgDialog({
  labelledBy,
  ariaLabel,
  wide = false,
  onClose,
  children,
}: {
  labelledBy?: string;
  ariaLabel?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useDialogA11y(true, onClose);
  return (
    <div className="ui-v2 u2-overlay">
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        className={`u2-dialog${wide ? ' u2-dialog--wide' : ''}`}
      >
        {children}
      </div>
    </div>
  );
}
