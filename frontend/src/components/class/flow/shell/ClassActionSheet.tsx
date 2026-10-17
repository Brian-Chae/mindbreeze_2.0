// SDD-209 SH5 — 취소·닫기·삭제 확인 시트(상담사). window.confirm 을 대체한다. 목록(FH01)과 상세(FH04)가 같이 쓴다.
import { TriangleAlert } from 'lucide-react';
import { ShellSheet } from './ShellSheet';
import './shell-kit.css';

export type ClassActionKind = 'cancel' | 'close' | 'delete';

interface ClassActionSheetProps {
  kind: ClassActionKind;
  /** 취소=초대한 회원 수, 닫기=대기 중인 회원 수 */
  count: number;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}

const COPY: Readonly<Record<ClassActionKind, { title: string; confirm: string; body: (n: number) => string }>> = {
  cancel: { title: '클래스를 취소할까요?', confirm: '클래스 취소', body: (n) => `초대한 회원 ${n}명에게 취소 안내가 가요. 취소한 클래스는 다시 열 수 없어요.` },
  close: { title: '클래스를 닫을까요?', confirm: '클래스 닫기', body: (n) => `대기 중인 회원 ${n}명이 모두 나가요. 닫은 클래스는 다시 열 수 없어요.` },
  delete: { title: '클래스를 삭제할까요?', confirm: '삭제', body: () => '기록과 초대 내역이 모두 사라지고 되돌릴 수 없어요.' },
};

export function ClassActionSheet({ kind, count, onConfirm, onClose, busy = false, error = null }: ClassActionSheetProps) {
  const copy = COPY[kind];
  return (
    <ShellSheet
      open
      tone="dark"
      title={copy.title}
      onClose={onClose}
      footerColumns={2}
      footer={
        <>
          <button type="button" className="sh-btn soft" data-testid="action-keep" disabled={busy} onClick={onClose}>유지하기</button>
          <button type="button" className="sh-btn danger" data-testid="action-confirm" disabled={busy} onClick={onConfirm}>{busy ? '처리 중' : copy.confirm}</button>
        </>
      }
    >
      <div className="sh-sico"><TriangleAlert size={24} aria-hidden="true" /></div>
      <p className="sh-sheet__desc">{copy.body(count)}</p>
      {error ? <p role="alert" className="sh-err sh-err--dark">{error}</p> : null}
    </ShellSheet>
  );
}
