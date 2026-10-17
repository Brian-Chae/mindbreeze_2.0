// SDD-209 SH1 — 셸형 시트(라이트 기본, 어두운 변형 선택). body 포털 + z-60 으로 하단 탭바 위에 뜬다.
// PlayerSheet 는 플레이어 그리드 안에서만 자리를 잡는 다크 전용이라 셸형에서는 쓰지 않는다(plan F22).
import { useId, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogA11y } from '../../../../hooks/useDialogA11y';
import './shell-kit.css';

interface ShellSheetProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  tone?: 'light' | 'dark';
  /** 본문 스크롤 밖 고정 버튼 영역 */
  footer?: ReactNode;
  footerColumns?: 1 | 2;
  children?: ReactNode;
}

function SheetBody({ title, description, onClose, tone, footer, footerColumns, children }: Omit<ShellSheetProps, 'open'>) {
  const titleId = useId();
  const ref = useDialogA11y(true, onClose);
  const onScrim = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose();
  };
  return (
    <div className="sh-scope sh-scrim" data-layer="sheet" onClick={onScrim}>
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sh-sheet"
        data-pz="flow-sheet"
        data-tone={tone}
      >
        <span className="sh-sheet__grab" aria-hidden="true" />
        <div className="sh-sheet__head">
          <div className="sh-sheet__hd">
            <h2 id={titleId} className="sh-sheet__title">{title}</h2>
            {description ? <p className="sh-sheet__desc">{description}</p> : null}
          </div>
          <button type="button" className="sh-sheet__x" aria-label="닫기" data-testid="shell-sheet-close" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children ? <div className="sh-sheet__body">{children}</div> : null}
        {footer ? <div className={`sh-sheet__foot${footerColumns === 2 ? ' two' : ''}`}>{footer}</div> : null}
      </section>
    </div>
  );
}

export function ShellSheet({ open, tone = 'light', footerColumns = 1, ...rest }: ShellSheetProps) {
  if (!open) return null;
  return createPortal(<SheetBody {...rest} tone={tone} footerColumns={footerColumns} />, document.body);
}
