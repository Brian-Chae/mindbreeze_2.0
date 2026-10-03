// 입장 전 체크인 — 대기실에서 기분(SAM 2축) + 상담사에게 전할 말을 가볍게 남긴다.
//
// 개선 3 대기실의 기기 단계별 셀프체크를 대신하는 핵심 입력. 저장은 REST(/sessions/{id}/checkin,
// phase='before')가 하고, onSubmitted 로 요약을 부모(대기실)에 전달해 WS 대기실 이벤트로
// 상담사 화면에 실시간 흘린다. 스킵 가능(입장을 막지 않는다).

import { useState } from 'react';
import { ApiError } from '../../lib/api/client';
import {
  SAM_AXES,
  SAM_VALUES,
  submitCheckin,
  type SamValue,
} from '../../lib/api/checkin';
import type { WaitingRoomCheckin } from '../../lib/socket';

interface PreCheckinPanelProps {
  sessionId: string;
  participantId: string | null;
  participantToken: string | null;
  isLoggedIn: boolean;
  /** 저장 성공 시 — 체크인 요약을 대기실(WS)로 흘린다 */
  onSubmitted?: (checkin: WaitingRoomCheckin) => void;
  onSkipped?: () => void;
}

const NOTE_MAX = 200;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '참여 확인에 실패해 체크인을 저장하지 못했습니다.';
    if (error.status === 422) return '체크인 내용을 다시 확인해 주세요.';
    if (error.message) return error.message;
  }
  return '체크인 저장에 실패했습니다. 입장은 가능합니다.';
}

export function PreCheckinPanel({
  sessionId,
  participantId,
  participantToken,
  isLoggedIn,
  onSubmitted,
  onSkipped,
}: PreCheckinPanelProps) {
  const [arousal, setArousal] = useState<SamValue | null>(null);
  const [valence, setValence] = useState<SamValue | null>(null);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<'input' | 'done' | 'skipped'>('input');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedNote = note.trim();
  const hasValue = arousal !== null || valence !== null || trimmedNote.length > 0;

  const handleSubmit = async (): Promise<void> => {
    if (!hasValue) {
      setError('기분을 선택하거나 상담사에게 전할 말을 적어 주세요.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await submitCheckin(
        sessionId,
        {
          phase: 'before',
          arousal,
          valence,
          note: trimmedNote || null,
          participant_id: participantId,
          participant_token: isLoggedIn ? null : participantToken,
        },
        { skipAuth: !isLoggedIn },
      );
      setPhase('done');
      onSubmitted?.({ arousal, valence, note: trimmedNote || null });
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (phase === 'skipped') return (
    <section className="rounded-xl border border-white/10 p-5 text-sm text-[#bcaec5]">
      <p>설문을 건너뛰었습니다. 준비를 마쳤어요.</p>
      <button type="button" onClick={() => setPhase('input')} className="mt-3 min-h-11 text-[#dcb5ee]">설문 작성하기</button>
    </section>
  );

  if (phase === 'done') {
    return (
      <section>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5F0080] text-[11px] font-bold text-white">
            ✓
          </span>
          <h2 className="text-xl font-semibold tracking-tight text-white">지금, 어떤 기분인가요?</h2>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/70">
          {arousal !== null || valence !== null ? (
            <>
              기분 · 각성 {arousal ?? '-'} · 정서 {valence ?? '-'}
              {trimmedNote ? <span className="block">상담사에게 전할 말: “{trimmedNote}”</span> : null}
            </>
          ) : trimmedNote ? (
            <>상담사에게 전할 말을 남겼습니다: “{trimmedNote}”</>
          ) : null}
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-white">지금, 어떤 기분인가요?</h2>
      </div>
      <p className="mt-2 text-[13px] leading-6 text-white/70">
        지금 기분을 가볍게 남겨 주세요. 상담사가 입장 전에 확인하고 세션을 준비합니다.
      </p>

      <div className="mt-4 space-y-4">
        {SAM_AXES.map((axis) => (
          <fieldset key={axis.key}>
            <legend className="text-[13px] font-medium text-white/70">
              {axis.label === '각성' ? '지금 몸의 긴장도(각성)' : '지금 기분(정서)'}
            </legend>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {SAM_VALUES.map((step) => {
                const selected =
                  (axis.key === 'arousal' ? arousal : valence) === step;
                return (
                  <button
                    key={step}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      axis.key === 'arousal' ? setArousal(step) : setValence(step)
                    }
                    disabled={isSubmitting}
                    className={`flex flex-col items-center justify-center rounded-xl border py-2 text-base font-bold transition ${
                      selected
                        ? 'border-[#dcb5ee]/60 bg-[#dcb5ee]/10 text-[#F7F4F0]'
                        : 'border-white/15 bg-transparent text-[#bcaec5] hover:border-[#dcb5ee]'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <span>{step}</span>
                    <span className="mt-0.5 text-[10px] font-medium leading-tight opacity-80">
                      {axis.steps[step]}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div>
          <label
            htmlFor="precheckin-note"
            className="text-[13px] font-medium text-white/70"
          >
            상담사에게 전하고 싶은 말 <span className="font-normal text-white/50">(선택)</span>
          </label>
          <textarea
            id="precheckin-note"
            value={note}
            maxLength={NOTE_MAX}
            disabled={isSubmitting}
            onChange={(event) => setNote(event.target.value)}
            placeholder="예: 오늘 목이 좀 불편해서 소리를 내기 어려워요"
            rows={2}
            className="mt-2 w-full resize-none rounded-xl border border-white/20 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-[#B373EF] focus:ring-2 focus:ring-[#5F0080]"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12px] text-[#F7C6C6]">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || !hasValue}
          className="mb-btn h-11 flex-1 justify-center rounded-xl px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? '저장 중...' : '체크인 남기기'}
        </button>
        <button
          type="button"
          onClick={() => { setPhase('skipped'); onSkipped?.(); }}
          disabled={isSubmitting}
          className="h-11 px-3 text-sm font-semibold text-white/60"
        >
          건너뛰기
        </button>
      </div>
    </section>
  );
}
