// BLE 끊김 구간 로그 (SDD-222 G2)
// 밴드는 자체 저장소가 없어 끊긴 구간은 영구 유실된다. 서버 공백과 대조할 수 있도록
// 구간(시작·종료·길이·사유·재시도 횟수)을 메모리 + localStorage 링버퍼에 남긴다.
// 서버 전송은 이번 범위 제외(백엔드 무변경).

import { createLogger } from './logger';

const logger = createLogger('ble-gap-log');

export const BLE_GAP_STORAGE_KEY = 'mb_ble_gap_log';
const DEFAULT_MAX_ENTRIES = 50;

export interface BleGap {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  reason: string;
  attempts: number;
}

export interface OpenBleGap {
  startedAt: number;
  reason: string;
  attempts: number;
}

export interface BleGapLog {
  open: (reason: string) => void;
  recordAttempt: () => void;
  close: () => BleGap | null;
  getOpenGap: () => OpenBleGap | null;
  getClosedGaps: () => BleGap[];
}

interface BleGapLogOptions {
  now?: () => number;
  maxEntries?: number;
}

function loadStored(): BleGap[] {
  try {
    const raw = localStorage.getItem(BLE_GAP_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BleGap[]) : [];
  } catch {
    return [];
  }
}

export function createBleGapLog(options: BleGapLogOptions = {}): BleGapLog {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  let openGap: OpenBleGap | null = null;
  let closedGaps: BleGap[] = loadStored().slice(-maxEntries);

  const persist = (): void => {
    try {
      localStorage.setItem(BLE_GAP_STORAGE_KEY, JSON.stringify(closedGaps));
    } catch {
      // 진단용 기록이므로 저장 실패(용량·프라이빗 모드)는 무시한다
    }
  };

  return {
    open(reason) {
      if (openGap) return;
      openGap = { startedAt: now(), reason, attempts: 0 };
      logger.warn('BLE 끊김 시작', openGap);
    },
    recordAttempt() {
      if (!openGap) return;
      openGap = { ...openGap, attempts: openGap.attempts + 1 };
    },
    close() {
      if (!openGap) return null;
      const endedAt = now();
      const gap: BleGap = {
        startedAt: openGap.startedAt,
        endedAt,
        durationMs: endedAt - openGap.startedAt,
        reason: openGap.reason,
        attempts: openGap.attempts,
      };
      openGap = null;
      closedGaps = [...closedGaps, gap].slice(-maxEntries);
      persist();
      logger.info('BLE 끊김 종료', gap);
      return gap;
    },
    getOpenGap: () => openGap,
    getClosedGaps: () => closedGaps,
  };
}

// 앱 전역 단일 로그 — useBand 가 사용한다.
export const bleGapLog: BleGapLog = createBleGapLog();
