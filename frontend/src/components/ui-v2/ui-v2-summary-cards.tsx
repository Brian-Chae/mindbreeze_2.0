// SDD-324 — 코치 화면 공용 요약 카드: 값 + 단위 + 기준 문구 + 클릭 동작.
// value === undefined → 카드 숨김(서버가 아직 안 내려줌), null → '집계 준비 중', 숫자 → 값(0 포함).
import type { ReactElement } from 'react';

export interface SummaryCardItem {
  key: string;
  label: string;
  value: number | null | undefined;
  unit: string;
  basis: string;
  active?: boolean;
  onClick?: () => void;
}

export function UiV2SummaryCards({ items, label }: { items: SummaryCardItem[]; label: string }): ReactElement | null {
  const shown = items.filter((i): i is SummaryCardItem & { value: number | null } => i.value !== undefined);
  if (shown.length === 0) return null;
  return (
    <div className="u2f-summary" role="group" aria-label={label} data-testid="summary-cards">
      {shown.map((i) => {
        const body = (
          <>
            <span className="u2f-summary__label">{i.label}</span>
            {i.value === null
              ? <b className="u2f-summary__pending">집계 준비 중</b>
              : <b>{i.value.toLocaleString('ko-KR')}<em>{i.unit}</em></b>}
            <small>{i.basis}</small>
          </>
        );
        if (!i.onClick || i.value === null) return <div key={i.key} className="u2-card u2f-summary__card" data-card={i.key}>{body}</div>;
        return <button key={i.key} type="button" className={`u2-card u2f-summary__card u2f-summary__card--btn${i.active ? ' is-active' : ''}`} data-card={i.key} aria-pressed={i.active ?? false} onClick={i.onClick}>{body}</button>;
      })}
    </div>
  );
}
