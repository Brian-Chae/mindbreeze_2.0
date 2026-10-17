// SDD-209 SH6 — 상담사 상세 더보기 시트(복제·템플릿 저장·삭제). 삭제는 확인 시트를 한 번 더 거친다.
import { Bookmark, Copy, Trash2 } from 'lucide-react';
import { ShellSheet } from './ShellSheet';
import './shell-kit.css';

interface HostMenuSheetProps {
  open: boolean;
  canDelete: boolean;
  templateSaved?: boolean;
  busy?: boolean;
  onDuplicate: () => void;
  onTemplate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function HostMenuSheet({ open, canDelete, templateSaved = false, busy = false, onDuplicate, onTemplate, onDelete, onClose }: HostMenuSheetProps) {
  return (
    <ShellSheet open={open} tone="dark" title="더보기" onClose={onClose}>
      <div className="sh-menu">
        <button type="button" data-testid="menu-duplicate" disabled={busy} onClick={onDuplicate}><Copy size={20} aria-hidden="true" />복제</button>
        <button type="button" data-testid="menu-template" disabled={busy || templateSaved} onClick={onTemplate}>
          <Bookmark size={20} aria-hidden="true" />{templateSaved ? '템플릿 저장됨' : '템플릿으로 저장'}
        </button>
        {canDelete ? (
          <button type="button" className="danger" data-testid="menu-delete" disabled={busy} onClick={onDelete}><Trash2 size={20} aria-hidden="true" />삭제</button>
        ) : null}
      </div>
    </ShellSheet>
  );
}
