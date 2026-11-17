// 녹음 정지 감지 — 상태가 recording 인데 진행 신호(청크 인덱스·업로드 수 합)가 STALL_MS 동안 늘지 않으면
// stalled 로 표시하고 자동 복구(onStall)를 정지 한 번당 1회만 시도한다.
// active=false(일시정지·마이크 꺼짐·정지·오류)에서는 감시를 끄고 기준선을 리셋한다 — 사용자가 마이크를 끈 구간을 정지로 오판하지 않기 위함.
import { useEffect, useRef, useState } from 'react';

export const STALL_MS = 30_000;
export const STALL_POLL_MS = 5_000;

export interface UseRecordingStallGuardOptions {
  /** 녹음 상태가 recording 일 때만 true */
  active: boolean;
  /** 진행 신호 — 청크가 만들어지거나 업로드되면 값이 커진다. 읽기 실패는 null(이번 주기 무시) */
  readProgress: () => number | null | Promise<number | null>;
  /** 정지 확정 시 정지 한 번당 1회 호출되는 자동 복구 */
  onStall: () => void | Promise<void>;
}

export function useRecordingStallGuard({ active, readProgress, onStall }: UseRecordingStallGuardOptions): { stalled: boolean } {
  const [stalled, setStalled] = useState(false);
  const readRef = useRef(readProgress);
  const stallRef = useRef(onStall);
  readRef.current = readProgress;
  stallRef.current = onStall;

  useEffect(() => {
    if (!active) {
      setStalled(false);
      return;
    }
    let disposed = false;
    let last: number | null = null;
    let changedAt = Date.now();
    let recovered = false;
    const tick = async (): Promise<void> => {
      let value: number | null;
      try {
        value = await readRef.current();
      } catch {
        return;
      }
      if (disposed || value === null) return;
      const now = Date.now();
      if (last === null || value !== last) {
        last = value;
        changedAt = now;
        recovered = false;
        setStalled(false);
        return;
      }
      if (now - changedAt < STALL_MS) return;
      setStalled(true);
      if (!recovered) {
        recovered = true;
        try {
          await stallRef.current();
        } catch {
          // 자동 복구 실패는 경고 배너가 대신 안내한다
        }
      }
    };
    const timer = window.setInterval(() => void tick(), STALL_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [active]);

  return { stalled };
}
