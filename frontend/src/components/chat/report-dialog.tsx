// 채팅 신고 대화상자 — 신고하면 상대와 서로 메시지를 주고받을 수 없게 된다(상호 차단). SDD-220
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CHAT_REPORT_CONTACT_EMAIL,
  CHAT_REPORT_REASONS,
  reportChatUser,
  type ChatReportReason,
  type ChatReportResult,
} from '../../lib/api/chat';

interface Props {
  targetUserId: string;
  targetName: string;
  roomId?: string;
  /** 메시지 메뉴에서 열었으면 해당 메시지 id (상대 프로필에서 열면 없음) */
  messageId?: string;
  onClose: () => void;
  /** 신고·차단이 서버에 접수된 직후 호출 — 호출자가 캐시를 정리한다 */
  onReported: (result: ChatReportResult) => void;
}

function newOperationKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ReportDialog({ targetUserId, targetName, roomId, messageId, onClose, onReported }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // 재시도해도 같은 키를 보내 서버가 중복 접수하지 않게 한다.
  const operationKey = useRef(newOperationKey());
  const [reason, setReason] = useState<ChatReportReason | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [busy, onClose]);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await reportChatUser({
        target_user_id: targetUserId,
        room_id: roomId,
        message_id: messageId,
        reason: reason || undefined,
        operation_key: operationKey.current,
      });
      setDone(true);
      onReported(result);
    } catch {
      setError('신고를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-bold text-[#1F1F1F]">
          {done ? '신고가 접수되었어요' : `${targetName} 님 신고`}
        </h2>
        {done ? (
          <div className="mt-3 space-y-3 text-sm text-[#1F1F1F]">
            <p>이제 서로 메시지를 주고받을 수 없고, 상대의 기존 메시지도 보이지 않아요.</p>
            <p className="text-[#6F6F6F]">
              추가로 알리실 내용이 있으면{' '}
              <a href={`mailto:${CHAT_REPORT_CONTACT_EMAIL}`} className="text-[#5F0080] underline">
                {CHAT_REPORT_CONTACT_EMAIL}
              </a>
              로 문의해 주세요.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-[#5F0080] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4B0066]"
            >
              확인
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-[#6F6F6F]">
              신고하면 상대와 서로 메시지를 주고받을 수 없게 돼요. 사유는 선택 사항이에요.
            </p>
            <fieldset className="space-y-2">
              <legend className="sr-only">신고 사유(선택)</legend>
              {CHAT_REPORT_REASONS.map((item) => (
                <label key={item.value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${titleId}-reason`}
                    checked={reason === item.value}
                    onChange={() => setReason(item.value)}
                    disabled={busy}
                  />
                  {item.label}
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="text-red-600">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 rounded-xl border border-[#DDDEE7] px-4 py-3 text-sm disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="flex-1 rounded-xl bg-[#5F0080] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4B0066] disabled:opacity-50"
              >
                {busy ? '접수 중…' : '신고하고 차단'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
