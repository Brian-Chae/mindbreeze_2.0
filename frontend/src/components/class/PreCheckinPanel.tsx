// 입장 전 체크인(사전) — 대기실에서 수업 전 기분(집중·편안함·감정 3축) + 상담사에게 전할 말을 남긴다.
//
// 사후 설문(수업 후)과 동일한 3축을 써서 '수업 전 → 수업 후' 변화를 비교할 수 있게 한다.
// 저장은 REST(/sessions/{id}/checkin, phase='before')가 하고, onSubmitted 로 요약을 부모(대기실)에
// 전달해 WS 대기실 이벤트로 상담사 화면에 실시간 흘린다. 스킵 가능(입장을 막지 않는다).
//
// 대기실이 3단계 준비 완료 후 대기 화면(WaitingForStart)으로 갔다가 [준비 다시 확인]으로 돌아와도
// 선택·입력 값이 그대로 보이도록, 초안(draft)을 부모(ClassWaitingRoom)가 보존하는 제어 모드를 지원한다.

import { useState } from 'react';
import { ApiError } from '../../lib/api/client';
import {
  EMPTY_CHECKIN_DRAFT,
  SAM_AXES,
  SAM_VALUES,
  submitCheckin,
  type AxisKey,
  type CheckinDraft,
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
  /** 부모(대기실)가 보존하는 제어 초안 — 없으면 내부 상태로 동작한다 */
  draft?: CheckinDraft;
  onDraftChange?: (draft: CheckinDraft) => void;
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
  draft,
  onDraftChange,
}: PreCheckinPanelProps) {
  const [internalDraft, setInternalDraft] = useState<CheckinDraft>(EMPTY_CHECKIN_DRAFT);
  const isControlled = draft !== undefined;
  const currentDraft: CheckinDraft = isControlled ? (draft as CheckinDraft) : internalDraft;
  const commitDraft = (next: CheckinDraft): void => {
    if (isControlled) onDraftChange?.(next);
    else setInternalDraft(next);
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mood, note, phase } = currentDraft;
  const trimmedNote = note.trim();
  const hasValue =
    mood.arousal !== null || mood.valence !== null || mood.emotion !== null || trimmedNote.length > 0;

  const setAxis = (key: AxisKey, value: SamValue): void => {
    commitDraft({ ...currentDraft, mood: { ...mood, [key]: value } });
  };

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
          arousal: mood.arousal,
          valence: mood.valence,
          emotion: mood.emotion,
          note: trimmedNote || null,
          participant_id: participantId,
          participant_token: isLoggedIn ? null : participantToken,
        },
        { skipAuth: !isLoggedIn },
      );
      commitDraft({ ...currentDraft, phase: 'done' });
      onSubmitted?.({
        arousal: mood.arousal,
        valence: mood.valence,
        emotion: mood.emotion,
        note: trimmedNote || null,
      });
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (phase === 'skipped') return (
    <section className="rounded-xl border border-white/10 p-5 text-sm text-[#bcaec5]">
      <p>설문을 건너뛰었습니다. 준비를 마쳤어요.</p>
      <button type="button" onClick={() => commitDraft({ ...currentDraft, phase: 'input' })} className="mt-3 min-h-11 text-[#dcb5ee]">설문 작성하기</button>
    </section>
  );

  if (phase === 'done') {
    return (
      <section>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5F0080] text-[12px] font-bold text-white">
            ✓
          </span>
          <h2 className="text-xl font-semibold tracking-tight text-white">지금, 어떤 기분인가요?</h2>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/70">
          {mood.arousal !== null || mood.valence !== null || mood.emotion !== null ? (
            <>
              기분{' '}
              {SAM_AXES.map((axis) =>
                mood[axis.key] !== null ? (
                  <span key={axis.key} className="mr-1.5 inline-block">
                    {axis.label} {mood[axis.key]}
                  </span>
                ) : null,
              )}
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
        수업 전 기분을 가볍게 남겨 주세요. 수업 후 느낌과 비교해 드립니다.
      </p>

      <div className="mt-4 space-y-4">
        {SAM_AXES.map((axis) => (
          <fieldset key={axis.key}>
            <legend className="text-[13px] font-medium text-white/70">지금 {axis.label}</legend>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {SAM_VALUES.map((step) => {
                const selected = mood[axis.key] === step;
                return (
                  <button
                    key={step}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setAxis(axis.key, step)}
                    disabled={isSubmitting}
                    className={`flex flex-col items-center justify-center rounded-xl border py-2 text-base font-bold transition ${
                      selected
                        ? 'border-[#dcb5ee]/60 bg-[#dcb5ee]/10 text-[#F7F4F0]'
                        : 'border-white/15 bg-transparent text-[#bcaec5] hover:border-[#dcb5ee]'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <span>{step}</span>
                    <span className="mt-0.5 text-[12px] font-medium leading-tight opacity-80">
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
            onChange={(event) => commitDraft({ ...currentDraft, note: event.target.value })}
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
          onClick={() => { commitDraft({ ...currentDraft, phase: 'skipped' }); onSkipped?.(); }}
          disabled={isSubmitting}
          className="h-11 px-3 text-sm font-semibold text-white/60"
        >
          건너뛰기
        </button>
      </div>
    </section>
  );
}
