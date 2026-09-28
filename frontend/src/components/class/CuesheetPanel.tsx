// 개선 7: 상담사 플레이어 — 진행 큐시트 패널(현재 단계 하이라이트 + 남은 시간 진행바).
//
// 클래스 경과 시간(기존 하단 진행시간 지표와 같은 started_at 경과 초)에 맞춰 현재 단계를
// 강조하고, 단계 전환 순간에는 상담사에게만 조용한 안내를 몇 초간 보여 준다(소리·팝업 없음).
// 회원 화면에는 이 패널을 렌더하지 않는다 — 상담사(host) 플레이어 전용이다.
import { useEffect, useRef, useState } from 'react';
import type { CuesheetStep } from '../../lib/api/session';
import {
  CUE_TRANSITION_FLASH_MS,
  computeCueProgress,
  formatCueClock,
} from '../../lib/class/cuesheet';

interface CuesheetPanelProps {
  cuesheet: CuesheetStep[] | null | undefined;
  /** 클래스 경과 초 — ClassPlayerPage 의 classElapsedSec 과 동일 출처(started_at 경과) */
  elapsedSec: number;
  /** 일시정지 상태 — 진행바는 유지하고 조용한 안내만 덧붙인다 */
  paused?: boolean;
}

export function CuesheetPanel({ cuesheet, elapsedSec, paused = false }: CuesheetPanelProps) {
  const progress = computeCueProgress(cuesheet, elapsedSec);
  const [notice, setNotice] = useState<string | null>(null);
  const prevIndexRef = useRef<number | null>(null);
  const currentLabel = progress.current?.label ?? null;

  // 단계가 바뀌는 순간에만 조용한 안내를 띄우고 스스로 사라지게 한다.
  // 의존성은 원시값(index·finished·label)만 둬 매초 리렌더에 흔들리지 않게 한다.
  useEffect(() => {
    const prev = prevIndexRef.current;
    prevIndexRef.current = progress.index;
    if (prev === null || progress.index < 0 || progress.index === prev) return undefined;
    setNotice(
      progress.finished
        ? '큐시트 마지막 단계까지 진행했습니다'
        : `${progress.index + 1}단계 · ${currentLabel ?? ''}`,
    );
    const timer = window.setTimeout(() => setNotice(null), CUE_TRANSITION_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [progress.index, progress.finished, currentLabel]);

  if (progress.timeline.length === 0 || !progress.current) return null;

  const current = progress.current;
  const remaining = progress.remainingSec ?? 0;

  return (
    <section
      aria-label="진행 큐시트"
      className="rounded-2xl bg-white/5 p-4"
      data-testid="cuesheet-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-white/50">진행 큐시트</p>
        <p className="text-xs text-white/40">
          {Math.min(progress.index + 1, progress.timeline.length)}/{progress.timeline.length} 단계
        </p>
      </div>

      {/* 현재 단계 — 하이라이트 + 남은 시간 진행바 */}
      <div className="mt-2 rounded-xl bg-[#5F0080]/25 px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-bold text-white">{current.label}</p>
          <p className="shrink-0 font-mono text-sm font-bold tabular-nums text-[#E9D5FF]">
            {progress.finished ? '완료' : `남은 ${formatCueClock(remaining)}`}
          </p>
        </div>
        {current.note && <p className="mt-1 text-xs text-white/70">{current.note}</p>}
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15"
          role="progressbar"
          aria-label="현재 단계 진행"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.ratio * 100)}
        >
          <div
            className="h-full rounded-full bg-[#C084FC] transition-[width] duration-700 ease-linear"
            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
          />
        </div>
        {progress.next && !progress.finished && (
          <p className="mt-2 text-[11px] text-white/45">
            다음 · {progress.next.label} ({progress.next.durationMin}분)
          </p>
        )}
      </div>

      {/* 단계 전환 조용한 안내 — 상담사에게만, 몇 초 뒤 사라진다 */}
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="mb-cue-notice mt-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-[#E9D5FF]"
        >
          ▶ {notice}
        </p>
      )}
      {paused && (
        <p className="mt-2 text-[11px] text-white/40">일시정지 중 — 진행 위치는 계속 흐릅니다</p>
      )}

      {/* 전체 타임라인 — 지난 단계는 흐리게, 현재 단계는 강조 */}
      <ol className="mt-3 space-y-1">
        {progress.timeline.map((entry) => {
          const isCurrent = entry.index === progress.index;
          const isPast = entry.index < progress.index;
          return (
            <li
              key={entry.index}
              className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs ${
                isCurrent ? 'bg-white/10 font-semibold text-white' : 'text-white/55'
              }`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11px] text-white/35">
                  {isPast ? '✓' : String(entry.index + 1).padStart(2, '0')}
                </span>
                <span className="truncate">{entry.label}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-white/35">
                {entry.durationMin}분
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default CuesheetPanel;
