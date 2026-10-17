// SDD-209 SH3 — 클래스 신청 바텀 시트(FM02). 상담사를 고르면 신청 메시지를 채팅으로 보낸다.
import { Circle, CircleCheck, Send, User } from 'lucide-react';
import { ShellSheet } from './ShellSheet';
import './shell-kit.css';

export interface ApplyOption {
  id: string;
  name: string;
  sub?: string;
}

interface ApplySheetProps {
  open: boolean;
  options: ApplyOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSend: () => void;
  onClose: () => void;
  sending?: boolean;
  /** 상담사 목록을 불러오지 못했을 때 */
  loadError?: string | null;
  onRetry?: () => void;
}

export function ApplySheet({ open, options, selectedId, onSelect, onSend, onClose, sending = false, loadError = null, onRetry }: ApplySheetProps) {
  return (
    <ShellSheet
      open={open}
      title="클래스 신청하기"
      description="신청 메시지를 상담사에게 보내요. 답을 받으면 알림으로 알려드려요."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sh-btn" data-testid="apply-send" disabled={sending || !selectedId} onClick={onSend}>
            <Send size={20} aria-hidden="true" />{sending ? '보내는 중' : '신청 메시지 보내기'}
          </button>
          <button type="button" className="sh-btn ghost" onClick={onClose}>닫기</button>
        </>
      }
    >
      {loadError ? (
        <div role="alert" className="sh-picks">
          <p className="sh-err">{loadError}</p>
          {onRetry ? <button type="button" className="sh-btn line" data-testid="apply-retry" onClick={onRetry}>다시 시도</button> : null}
        </div>
      ) : options.length === 0 ? (
        <p className="sh-sheet__desc">연결된 상담사 채팅방이 없어요</p>
      ) : (
        <div className="sh-picks" role="radiogroup" aria-label="상담사 선택">
          {options.map((option) => {
            const checked = option.id === selectedId;
            return (
              <button key={option.id} type="button" role="radio" aria-checked={checked} className="sh-pick" onClick={() => onSelect(option.id)}>
                <span className="sh-pick__av"><User size={20} aria-hidden="true" /></span>
                <span className="sh-pick__tx"><b>{option.name}</b>{option.sub ? <span>{option.sub}</span> : null}</span>
                {checked ? <CircleCheck size={20} className="sh-pick__end" aria-hidden="true" /> : <Circle size={20} className="sh-pick__end" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </ShellSheet>
  );
}
