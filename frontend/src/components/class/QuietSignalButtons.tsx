// 개선 5: 회원 무음 시그널 버튼 3종 — 잘 따라가요 / 조금 어려워요 / 잠시 쉴게요
//
// 기본 뮤트 1:N 수업에서는 발언권(손들기) 없이 상담사에게 상태를 전할 방법이 없다.
// 이 버튼은 발언권과 독립적으로 언제든 눌릴 수 있고, 소리·팝업 없이
// 짧은 확인 문구만 남긴다(실패 시에만 조용한 안내). 상담사에게만 전달된다.

import { useEffect, useRef, useState } from 'react';
import {
  CLASS_SIGNAL_META,
  CLASS_SIGNAL_TYPES,
  type ClassSignalType,
} from '../../lib/class/quiet-signal';

/** 확인 문구 표시 시간(ms) — 성공/실패 모두 짧게만 남긴다 */
const FEEDBACK_MS = 4000;

interface QuietSignalButtonsProps {
  /** 신호 전송 — 미연결이면 false 를 돌려준다 */
  onSend: (signalType: ClassSignalType) => boolean;
}

interface SignalFeedback {
  type: ClassSignalType;
  ok: boolean;
}

export function QuietSignalButtons({ onSend }: QuietSignalButtonsProps) {
  const [feedback, setFeedback] = useState<SignalFeedback | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleClick = (type: ClassSignalType): void => {
    const ok = onSend(type);
    setFeedback({ type, ok });
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setFeedback(null);
      timerRef.current = null;
    }, FEEDBACK_MS);
  };

  const sentType = feedback?.ok ? feedback.type : null;

  return (
    <section className="player-signals" aria-label="조용한 상태 신호">
      <p className="player-signals-hint">지금 상태를 조용히 알려 주세요 · 상담사에게만 보여요</p>
      <div className="player-signals-row">
        {CLASS_SIGNAL_TYPES.map((type) => {
          const meta = CLASS_SIGNAL_META[type];
          const active = sentType === type;
          return (
            <button
              key={type}
              type="button"
              className="player-signal"
              data-signal={type}
              data-active={active}
              onClick={() => handleClick(type)}
              aria-pressed={active}
              title={meta.hint}
            >
              <span className="player-signal-icon" aria-hidden="true">{meta.icon}</span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>
      {/* 조용한 확인 — 소리·팝업 없이 문구만 */}
      <p role="status" aria-live="polite" className="player-signals-status">
        {feedback
          ? feedback.ok
            ? '상담사에게 조용히 전달했어요'
            : '전송하지 못했어요 — 연결을 확인해 주세요'
          : ''}
      </p>
    </section>
  );
}
