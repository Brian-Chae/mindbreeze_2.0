// 리포트 보내기 시트 (SDD-327 T15) — 모바일 바텀시트 / 데스크톱 모달.
// 회원: POST /me/reports/{id}/share-email, 상담사·기관관리자: 기존 resendReportEmail.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { buttonClass } from '../ui';
import { resendReportEmail } from '../../lib/api/reports';
import {
  REPORT_SHARE_MAX_MESSAGE_LEN,
  REPORT_SHARE_MAX_RECIPIENTS,
  shareMyReportByEmail,
  type ReportShareResponse,
} from '../../lib/api/report-share';
import {
  addRecipient,
  classifyShareError,
  type ShareFailureKind,
} from './report-share-utils';

export type ReportShareMode = 'member' | 'counselor';

export interface ReportShareSheetProps {
  reportId: string;
  /** 시트 머리 부제 (예: "몸돌봄 2회차 · 2026.11.11") */
  subtitle?: string;
  mode: ReportShareMode;
  /** 상담사 모드 기본 수신 주소(저장된 리포트 수신 메일) */
  defaultRecipient?: string | null;
  onClose: () => void;
  /** 발송 접수 후(이력 새로고침용) */
  onSent?: () => void;
  /** 앱(Capacitor)에서 "다른 앱으로 공유" 눌렀을 때 — 연결은 T16 */
  onNativeShare?: () => void;
}

type Phase = 'form' | 'sending' | 'success' | ShareFailureKind;

const DAILY_LIMIT_LABEL: Record<ReportShareMode, string> = {
  member: '회원은 하루 최대 10통까지 보낼 수 있어요.',
  counselor: '하루 최대 300통까지 보낼 수 있어요.',
};

function isNativeApp(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export default function ReportShareSheet({
  reportId, subtitle, mode, defaultRecipient, onClose, onSent, onNativeShare,
}: ReportShareSheetProps) {
  const [recipients, setRecipients] = useState<string[]>(() => {
    const seed = defaultRecipient?.trim().toLowerCase();
    return mode === 'counselor' && seed ? [seed] : [];
  });
  const [draft, setDraft] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [result, setResult] = useState<ReportShareResponse | null>(null);
  const [counselorFailMsg, setCounselorFailMsg] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const native = useMemo(() => isNativeApp(), []);

  // Escape 닫기 + 열릴 때 포커스 이동 (발송 중에는 닫지 않음)
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'sending') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  const commitDraft = (): string[] | null => {
    if (!draft.trim()) return recipients;
    const r = addRecipient(recipients, draft, REPORT_SHARE_MAX_RECIPIENTS);
    if (!r.ok) {
      setFieldError(
        r.reason === 'invalid' ? '메일 주소를 확인해 주세요. 예: name@example.com'
          : r.reason === 'duplicate' ? '이미 추가한 주소예요.'
          : `주소는 최대 ${REPORT_SHARE_MAX_RECIPIENTS}곳까지 보낼 수 있어요.`,
      );
      return null;
    }
    setRecipients(r.recipients);
    setDraft('');
    setFieldError(null);
    return r.recipients;
  };

  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && !draft && recipients.length > 0) {
      setRecipients(recipients.slice(0, -1));
    }
  };

  const removeRecipient = (email: string) => {
    setRecipients(recipients.filter((r) => r !== email));
    setFieldError(null);
  };

  const canSend = phase === 'form' && confirmed && (recipients.length > 0 || isDraftOk(draft));
  function isDraftOk(v: string) { return v.trim().length > 0 && addRecipient(recipients, v, REPORT_SHARE_MAX_RECIPIENTS).ok; }

  const send = async () => {
    const list = commitDraft();
    if (!list || list.length === 0 || !confirmed) return;
    setPhase('sending');
    setCounselorFailMsg(null);
    try {
      if (mode === 'member') {
        const res = await shareMyReportByEmail(reportId, {
          recipients: list,
          attach_pdf: attachPdf,
          message: message.trim() ? message.trim() : null,
        });
        setResult(res);
      } else {
        // 상담사·기관관리자 경로: 기존 재발송 API 를 주소별로 순차 호출
        for (const email of list) {
          const res = await resendReportEmail(reportId, email);
          if (!res.success || !res.sent) {
            setCounselorFailMsg(res.message || '메일 발송에 실패했습니다.');
            setPhase('server');
            return;
          }
        }
        setResult({ accepted_count: list.length, attached: false, delivery_delayed: false, daily_remaining: null, events: [] });
      }
      setPhase('success');
      onSent?.();
    } catch (e) {
      setPhase(classifyShareError(e));
    }
  };

  const sentCount = result?.accepted_count ?? recipients.length;
  const rejectedCount = result?.rejected?.length ?? 0;
  const sendLabel = phase === 'sending' ? '보내는 중…'
    : `${Math.max(recipients.length, draft.trim() ? 1 : 0) || ''}${recipients.length || draft.trim() ? '곳에 ' : ''}보내기`;

  const statusBody = (() => {
    if (phase === 'sending') return { icon: '↗', title: '리포트를 보내고 있어요', lines: ['잠시만 기다려 주세요.', '발송이 끝나면 결과를 알려드릴게요.'], tone: 'info' as const };
    if (phase === 'success') {
      const delayed = result?.delivery_delayed;
      return {
        icon: '✓', title: rejectedCount > 0 ? `${sentCount}곳에 보냈어요 · ${rejectedCount}곳은 주소를 확인해 주세요` : `${sentCount}곳에 보냈어요`,
        lines: delayed ? ['메일 전달이 평소보다 조금 늦어질 수 있어요.', '결과는 리포트 아래 보낸 기록에서 확인해요.'] : ['함께 나누고 싶은 분께', '오늘의 기록을 보냈어요.'],
        tone: 'ok' as const,
      };
    }
    if (phase === 'limit') return { icon: '!', title: '오늘 보낼 수 있는 수를 채웠어요', lines: [DAILY_LIMIT_LABEL[mode], '내일 00:00 이후에 다시 보내 주세요.'], tone: 'warn' as const };
    if (phase === 'invalid') return { icon: '!', title: '메일 주소를 확인해 주세요', lines: ['받는 주소 형식이 올바르지 않거나 보낼 수 없는 주소예요.', '수정 후 다시 보내 주세요.'], tone: 'warn' as const };
    if (phase === 'server') return { icon: '!', title: '메일을 보내지 못했어요', lines: [counselorFailMsg ?? '발송 서비스에 잠시 문제가 있어요.', '입력한 내용은 그대로 있어요. 잠시 후 다시 시도해 주세요.'], tone: 'warn' as const };
    return null;
  })();

  const node = (
    <div
      data-print-exclude
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[#282430]/50 md:items-center md:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'sending') onClose(); }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="리포트 보내기"
        className="flex max-h-[100dvh] w-full flex-col rounded-t-3xl bg-white shadow-xl outline-none md:max-h-[90vh] md:max-w-[520px] md:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
          <div>
            <h2 className="text-[18px] font-bold text-[#282430]">리포트 보내기</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-[#6D547A]">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            disabled={phase === 'sending'}
            className={buttonClass({ variant: 'icon', className: 'disabled:opacity-40' })}
          >×</button>
        </div>

        {statusBody ? (
          <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-5" role={phase === 'success' ? 'status' : phase === 'sending' ? 'status' : 'alert'}>
            <div className="mt-4 flex flex-col items-center rounded-2xl bg-[#FAF6FC] px-4 py-6 text-center">
              <span aria-hidden className={`flex h-12 w-12 items-center justify-center rounded-full text-[22px] font-bold ${statusBody.tone === 'ok' ? 'bg-[#E4F5EC] text-[#26724B]' : statusBody.tone === 'warn' ? 'bg-[#FDECEF] text-[#B3264B]' : 'bg-[#F5EDFC] text-[#5F0080]'}`}>{statusBody.icon}</span>
              <h3 className="mt-3 text-[17px] font-bold text-[#282430]">{statusBody.title}</h3>
              {statusBody.lines.map((l) => (<p key={l} className="mt-1 text-[13px] text-[#6D547A]">{l}</p>))}
            </div>
            {recipients.length > 0 && (
              <ul className="mt-3 space-y-1 text-[13px] text-[#282430]">
                {recipients.map((r) => (<li key={r}>받는 분 · {maskEmail(r)}</li>))}
                <li className="text-[#6D547A]">{mode === 'member' && attachPdf ? '열람 링크 + 명상 기록 책 PDF' : '열람 링크'}</li>
              </ul>
            )}
            <div className="mt-5 flex gap-2">
              {phase === 'sending' ? (
                <button type="button" disabled className={buttonClass({ className: 'flex-1' })}>보내는 중…</button>
              ) : phase === 'success' || phase === 'limit' ? (
                <button type="button" onClick={onClose} className={buttonClass({ className: 'flex-1' })}>확인</button>
              ) : (
                <>
                  <button type="button" onClick={() => setPhase('form')} className={buttonClass({ variant: 'secondary', className: 'flex-1' })}>{phase === 'invalid' ? '주소 수정' : '입력으로 돌아가기'}</button>
                  {phase === 'server' && <button type="button" onClick={send} className={buttonClass({ className: 'flex-1' })}>다시 시도</button>}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 pb-3">
              <label htmlFor="rs-address" className="mt-2 block text-[14px] font-semibold text-[#282430]">
                받는 메일 <small className="font-normal text-[#6D547A]">최대 {REPORT_SHARE_MAX_RECIPIENTS}개</small>
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-[#DDDEE7] bg-white px-2.5 py-2 focus-within:border-[#5F0080] focus-within:ring-2 focus-within:ring-[#5F0080]/15">
                {recipients.map((r) => (
                  <span key={r} className="inline-flex items-center gap-1 rounded-full bg-[#F5EDFC] py-1 pl-3 pr-1 text-[13px] text-[#5F0080]">
                    {r}
                    <button type="button" aria-label={`${r} 삭제`} onClick={() => removeRecipient(r)} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-[#EADFF2]">×</button>
                  </span>
                ))}
                <input
                  id="rs-address"
                  type="email"
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setFieldError(null); }}
                  onKeyDown={onDraftKey}
                  onBlur={() => { if (draft.trim()) commitDraft(); }}
                  disabled={recipients.length >= REPORT_SHARE_MAX_RECIPIENTS}
                  placeholder={recipients.length >= REPORT_SHARE_MAX_RECIPIENTS ? '' : '메일 주소 입력 후 Enter'}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby="rs-address-help"
                  className="min-w-[10rem] flex-1 bg-transparent py-1 text-[14px] text-[#282430] placeholder:text-[#9B9B9B] focus:outline-none"
                />
              </div>
              <p id="rs-address-help" className="mt-1 text-[12px] text-[#6D547A]">최대 {REPORT_SHARE_MAX_RECIPIENTS}곳 · {DAILY_LIMIT_LABEL[mode]}</p>
              {fieldError && <p role="alert" className="mt-1 text-[12px] font-medium text-[#B3264B]">{fieldError}</p>}

              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#FAF6FC] px-3.5 py-2.5">
                <div>
                  <b className="text-[14px] text-[#282430]">명상 기록 책 PDF 첨부</b>
                  <p className="text-[12px] text-[#6D547A]">8MB를 넘으면 열람 링크만 보내요.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={attachPdf}
                  aria-label="명상 기록 책 PDF 첨부"
                  onClick={() => setAttachPdf((v) => !v)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${attachPdf ? 'bg-[#5F0080]' : 'bg-[#C9C4D0]'}`}
                >
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${attachPdf ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>

              <label htmlFor="rs-message" className="mt-3 block text-[14px] font-semibold text-[#282430]">함께 보낼 메시지 (선택)</label>
              <textarea
                id="rs-message"
                value={message}
                maxLength={REPORT_SHARE_MAX_MESSAGE_LEN}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="오늘의 명상 기록을 함께 나누고 싶어요."
                rows={2}
                className="mt-1.5 w-full resize-none rounded-xl border border-[#DDDEE7] px-3.5 py-2 text-[14px] text-[#282430] placeholder:text-[#9B9B9B] focus:border-[#5F0080] focus:outline-none focus:ring-2 focus:ring-[#5F0080]/15"
              />
              <div className="text-right text-[12px] text-[#6D547A]">{message.length} / {REPORT_SHARE_MAX_MESSAGE_LEN}</div>

              <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-[#E8D9F5] bg-[#FDFAFF] p-3">
                <input id="rs-confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#5F0080]" />
                <label htmlFor="rs-confirm" className="text-[13px] leading-snug text-[#282430]">
                  심박·뇌파 등 개인 기록이 담겨 있어요. 받는 분이 열어볼 수 있어요.<br /><b>내용을 확인했어요.</b>
                </label>
              </div>
            </div>

            <div className="border-t border-[#EFE6F5] bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <div className="flex gap-2">
                <button type="button" onClick={send} disabled={!canSend} className={buttonClass({ className: 'flex-1' })}>{sendLabel}</button>
                {native && onNativeShare && (
                  <button type="button" onClick={onNativeShare} className={buttonClass({ variant: 'secondary' })}>다른 앱으로 공유</button>
                )}
              </div>
              <p className="mt-2 text-center text-[12px] text-[#6D547A]">링크는 7일 동안 열 수 있어요. 같은 주소로는 1분 뒤에 다시 보낼 수 있어요.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
  return createPortal(node, document.body);
}

function maskEmail(email: string): string {
  const [local, domain = ''] = email.split('@');
  const [host, ...rest] = domain.split('.');
  return `${local.slice(0, 2)}***@${host.slice(0, 1)}***${rest.length ? '.' + rest.join('.') : ''}`;
}
