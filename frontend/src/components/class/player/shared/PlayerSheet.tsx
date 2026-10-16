// SDD-208 — 시트(바텀/사이드). 분기는 sheet-mode.ts 한 곳에서만 판정한다.
// 접근성(verify P14): role=dialog·aria-modal, Esc/바깥 pointerdown/닫기 버튼으로 닫힘, 열면 포커스 진입·닫으면 열었던 버튼으로 복귀.
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconCircleButton } from './IconCircleButton';
import { useSheetMode } from './sheet-mode';
import './player-shared.css';

interface PlayerSheetProps {
  open: boolean;
  title: string;
  /** 제목 옆 보조 문구(예: "6지표") */
  sub?: string;
  /** 채팅처럼 내용과 무관하게 높이를 고정해야 하는 시트 */
  tall?: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function PlayerSheet({ open, title, sub, tall, onClose, children }: PlayerSheetProps) {
  const mode = useSheetMode();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 열 때 포커스를 시트로 옮기고, 닫을 때(또는 언마운트) 열었던 요소로 되돌린다
  useEffect(() => {
    if (!open) return undefined;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    const onPointerDown = (e: Event): void => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (dialogRef.current?.contains(target)) return;
      // 도크에서 다른 항목을 눌러 시트를 바꾸는 동작, 위에 뜬 다른 모달 안의 조작은 닫기로 보지 않는다
      if (target.closest('[data-pz="dock"]')) return;
      const modal = target.closest('[aria-modal="true"]');
      if (modal && modal !== dialogRef.current) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (!open) return null;

  return (
    <section
      ref={dialogRef}
      className="pz-sheet"
      data-pz="sheet"
      data-mode={mode}
      data-tall={tall ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      {mode === 'bottom' ? <span className="pz-sheet__handle" aria-hidden="true" /> : null}
      <header className="pz-sheet__head">
        <h2>
          {title}
          {sub ? <span className="pz-sheet__sub">{sub}</span> : null}
        </h2>
        <IconCircleButton label="닫기" icon={<X size={24} strokeWidth={2} />} variant="ghost" onClick={onClose} />
      </header>
      <div className="pz-sheet__body">{children}</div>
    </section>
  );
}
