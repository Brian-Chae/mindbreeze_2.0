// 상담사 코드 입력 바텀시트 — 홈·설정 공용 (SDD-256)
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus } from 'lucide-react';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { buttonClass } from '../ui';
import { COUNSELOR_COPY as T } from '../../lib/client-counselor-copy';
import {
  classifyAddCounselorError,
  normalizeCounselorCode,
  type ClientCounselor,
} from '../../lib/api/client-counselors';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 훅의 addCounselor. 성공 시 즉시 병합된 상태에서 refreshed(GET 재검증 성공 여부)를 돌려준다. */
  addCounselor: (code: string) => Promise<{ counselor: ClientCounselor; refreshed: boolean }>;
  onAdded?: (counselor: ClientCounselor) => void;
}

export function CounselorAddSheet({ open, onOpenChange, addCounselor, onAdded }: Props) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ name: string; refreshed: boolean } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const titleId = useId();
  const descId = useId();
  const dialogRef = useDialogA11y(open, () => onOpenChange(false));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 닫을 때 입력·상태 초기화 (재오픈 시 깨끗한 시트)
  useEffect(() => {
    if (!open) {
      setRaw('');
      setError(null);
      setDone(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const compact = raw.replace(/\s+/g, '');
  const normalized = normalizeCounselorCode(raw);
  const formatInvalid = compact.length > 0 && !/^[0-9]*$/.test(compact);
  const tooLong = compact.length > 6;
  const inlineError = error ?? (formatInvalid || tooLong ? T.invalidFormat : null);
  const canSubmit = !!normalized && !submitting && !done;

  async function submit() {
    if (!normalized || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const { counselor, refreshed } = await addCounselor(normalized);
      if (!mounted.current) return;
      setDone({ name: counselor.name, refreshed });
      onAdded?.(counselor);
    } catch (err) {
      if (!mounted.current) return;
      setError(classifyAddCounselorError(err).message); // 입력은 그대로 유지
    } finally {
      inFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  // 조상의 stacking context(카드 transform 등) 때문에 하단 탭바에 가려지지 않도록 body 로 포털한다.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl"
      >
        <div className="mb-1 flex items-center gap-2">
          <UserPlus size={20} aria-hidden="true" className="text-[#5F0080]" />
          <h2 id={titleId} className="text-[18px] font-bold text-[#1F1F1F]">{T.sheetTitle}</h2>
        </div>
        <p id={descId} className="mb-4 text-[15px] leading-[22px] text-[#6F6F6F]">{T.sheetDescription}</p>

        {done ? (
          <div role="status" aria-live="polite">
            <p className="mb-4 text-[15px] font-semibold text-[#1F1F1F]">
              {done.name ? `${done.name} ` : ''}{done.refreshed ? T.success : T.successRefreshFailed}
            </p>
            <button type="button" onClick={() => onOpenChange(false)} className={buttonClass({ className: 'min-h-12 w-full' })}>
              {T.done}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label htmlFor={`${titleId}-code`} className="mb-1 block text-[13px] font-semibold text-[#6F6F6F]">
              {T.codeLabel}
            </label>
            <input
              id={`${titleId}-code`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              value={raw}
              disabled={submitting}
              onChange={(e) => {
                setRaw(e.target.value.replace(/[^0-9]/g, '').slice(0, 6));
                setError(null);
              }}
              aria-invalid={!!inlineError}
              aria-describedby={inlineError ? `${titleId}-err` : undefined}
              placeholder="예: 123456"
              className={`mb-2 min-h-12 w-full rounded-xl border-2 px-4 text-center text-[20px] font-bold tracking-[0.3em] outline-none ${
                inlineError ? 'border-red-400 bg-red-50' : 'border-[#E8E3EC] focus:border-[#5F0080]'
              }`}
            />
            <div aria-live="polite" className="min-h-[22px]">
              {inlineError && (
                <p id={`${titleId}-err`} role="alert" className="text-[14px] text-red-600">{inlineError}</p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="min-h-12 flex-1 rounded-xl border border-[#E8E3EC] text-[15px] font-medium text-[#6F6F6F]"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={!canSubmit || formatInvalid || tooLong}
                className={buttonClass({ className: 'min-h-12 flex-[2] disabled:opacity-50' })}
              >
                {submitting ? T.submitting : T.submit}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
