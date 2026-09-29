// 클래스 온보딩 코치마크 — 최초 1회(스킵 가능) 규칙 안내.
//
// 첫 참여자(게스트/신규 회원)가 기본 뮤트 · 손들기(발언권) · 스피커 온오프 ·
// 몰입(화면 끄기) 모드 규칙을 모른 채 입장해 당황하지 않도록 순차 스텝으로 안내한다.
//
// 노출 정책(순수 로직은 lib/class/class-onboarding.ts):
//   · localStorage(mb_class_onboarding_seen='1')이면 노출하지 않는다.
//   · [건너뛰기]는 이번 화면에서만 닫고 저장하지 않는다(다음 입장 시 다시 안내).
//   · [다시 보지 않기]를 체크하고 닫거나, 마지막 스텝을 [완료]하면 영구 저장한다.
//
// 스텝은 세션 모드에 맞춰 구성한다(SDD-094와 동일 규칙):
//   · 온라인 그룹(≤20) — 기본 뮤트 → [손 들기]로 발언권 요청
//   · 온라인 1:1       — 상시 송출(마이크·카메라 켜짐)
//   · 오프라인         — 하울링 방지를 위해 상담사 음성 기본 음소거

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCoachmarkSteps,
  isClassOnboardingSeen,
  markClassOnboardingSeen,
  type CoachmarkMode,
} from '../../lib/class/class-onboarding';

interface ClassOnboardingCoachmarksProps extends CoachmarkMode {
  /** 노출 이력을 무시하고 강제로 연다(미리보기·테스트) */
  forceOpen?: boolean;
  /** 마지막 스텝 완료 또는 건너뛰기로 닫힐 때 1회 호출 */
  onFinish?: () => void;
}

export function ClassOnboardingCoachmarks({
  locationType,
  participantMode,
  maxParticipants,
  forceOpen = false,
  onFinish,
}: ClassOnboardingCoachmarksProps) {
  /** 마운트 시점 노출 이력 — 렌더마다 localStorage를 다시 읽지 않는다. */
  const [seenAtMount] = useState<boolean>(() => isClassOnboardingSeen());
  const [dismissed, setDismissed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  /** [다시 보지 않기] 체크 — 닫는 경로와 무관하게 이 값이 true면 영구 저장한다. */
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // forceOpen이면 노출 이력을 무시한다 — 상태 파생값으로 계산해 effect 부수효과를 피한다.
  const open = !dismissed && (forceOpen || !seenAtMount);

  const steps = useMemo(
    () => buildCoachmarkSteps({ locationType, participantMode, maxParticipants }),
    [locationType, participantMode, maxParticipants],
  );

  const close = useCallback(
    (persist: boolean) => {
      if (persist) markClassOnboardingSeen();
      setDismissed(true);
      onFinish?.();
    },
    [onFinish],
  );

  const goNext = useCallback(() => {
    // 마지막 스텝 완료 → 전체 안내를 마쳤으므로 영구 저장하고 닫는다.
    if (stepIndex >= steps.length - 1) {
      close(true);
      return;
    }
    setStepIndex(stepIndex + 1);
  }, [stepIndex, steps.length, close]);

  const goPrev = useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  /** 건너뛰기 — [다시 보지 않기]를 체크했을 때만 영구 저장한다. */
  const skip = useCallback(() => close(dontShowAgain), [close, dontShowAgain]);

  // 열릴 때 다이얼로그로 포커스 이동 (키보드 접근성)
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  // Escape/방향키 — 닫기·스텝 이동
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') skip();
      else if (event.key === 'ArrowRight') goNext();
      else if (event.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, skip, goNext, goPrev]);

  if (!open || steps.length === 0) return null;

  const current = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="class-onboarding-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-3xl border border-[#B373EF]/25 bg-[#1A0B22]/95 p-6 text-white shadow-2xl outline-none sm:p-7"
      >
        {/* 상단: 진행 표시 + 건너뛰기 */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium tabular-nums text-white/60">
            {stepIndex + 1} / {steps.length}
          </span>
          <button
            type="button"
            onClick={skip}
            className="min-h-11 inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            건너뛰기
          </button>
        </div>

        {/* 본문: 아이콘 + 제목 + 설명 */}
        <div className="mt-5 flex flex-col items-center text-center">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-[#5F0080]/40 text-3xl ring-1 ring-[#B373EF]/30"
          >
            {current.icon}
          </span>
          <h2
            id="class-onboarding-title"
            className="mt-4 text-lg font-semibold leading-snug text-white"
          >
            {current.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/70">{current.body}</p>
        </div>

        {/* 진행 점 */}
        <div className="mt-6 flex items-center justify-center gap-1.5" aria-hidden="true">
          {steps.map((step, index) => (
            <span
              key={step.id}
              className={`h-1.5 rounded-full transition-all ${
                index === stepIndex ? 'w-6 bg-[#B373EF]' : 'w-1.5 bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* 하단: 다시 보지 않기 + 이전/다음 */}
        <div className="mt-6 flex flex-col gap-4">
          <label className="flex cursor-pointer items-center justify-center gap-2 text-xs text-white/60">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => setDontShowAgain(event.target.checked)}
              className="h-3.5 w-3.5 accent-[#B373EF]"
            />
            다시 보지 않기
          </label>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goPrev}
              disabled={stepIndex === 0}
              className="h-11 rounded-xl border border-white/20 px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              이전
            </button>
            <button
              type="button"
              onClick={goNext}
              className="h-11 flex-1 rounded-xl bg-[#5F0080] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#4C0066]"
            >
              {isLast ? '완료' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
