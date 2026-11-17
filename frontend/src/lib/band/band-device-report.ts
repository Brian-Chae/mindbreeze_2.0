// SDD-326 — 연결된 LINK BAND 의 시리얼(광고 이름)·펌웨어를 서버에 보고하는 순수 로직.
// 보고는 부가 기능이다: 실패해도 밴드 연결·측정 흐름을 막지 않고, 같은 값은 한 번만 보낸다.
import type { PutBandDeviceBody } from '../api/class-flow';

/** 광고 이름 접두사(LXB). 서버 검증 정규식과 같은 문자 집합. */
export const BAND_SERIAL_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/; // 서버: ^LXB[A-Za-z0-9._:-]{0,61}$ (LXB 접두 + 합 64자)
const BAND_NAME_PREFIX = 'LXB';
export const REPORT_RETRY_DELAYS_MS: readonly number[] = [2000, 6000, 15000];

export interface BandIdentity { serial: string; firmware: string | null }
export type BandPlatform = PutBandDeviceBody['platform'];

/** 광고 이름 → 시리얼. LXB 접두사가 아니거나 형식이 안 맞으면(이메일 등) null — 저장하지 않는다. */
export function normalizeBandSerial(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().toUpperCase();
  if (!trimmed.startsWith(BAND_NAME_PREFIX)) return null;
  return BAND_SERIAL_PATTERN.test(trimmed) ? trimmed : null;
}

/** 서버 계약(FIRMWARE_PATTERN)과 같은 문자 집합. 어긋나면 서버가 422 로 거부하므로 보내기 전에 걸러낸다. */
export const FIRMWARE_PATTERN = /^[A-Za-z0-9._+-]{1,32}$/;

/** 펌웨어 문자열 정리: 제어문자 제거·32자 이내. 서버 형식에 안 맞으면 null(시리얼만 보고). */
export function normalizeFirmware(raw: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex -- BLE 문자열 끝의 NUL 등을 제거한다
  const cleaned = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  return FIRMWARE_PATTERN.test(cleaned) ? cleaned : null;
}

export const maskSerial = (serial: string): string => (serial.length <= 4 ? serial : `${serial.slice(0, 3)}…${serial.slice(-4)}`);

export const reportKey = (sessionId: string, identity: BandIdentity): string => `${sessionId}:${identity.serial}:${identity.firmware ?? ''}`;

export interface BandReportDeps {
  put: (sessionId: string, credential: string | null, body: PutBandDeviceBody) => Promise<unknown>;
  wait?: (ms: number) => Promise<void>;
  /** 테스트에서 모듈 상태를 분리하기 위해 주입한다. */
  sent?: Set<string>;
}

const defaultSent = new Set<string>();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const inflight = new Set<string>();

/**
 * 시리얼 보고. 성공하면 true, 건너뛰면(미식별·중복·진행 중) false, 재시도 후에도 실패하면 false.
 * 던지지 않는다 — 호출부는 결과를 기다릴 필요 없이 `void` 로 부른다.
 */
export async function reportBandDevice(
  input: { sessionId: string; credential: string | null; identity: BandIdentity | null; platform: BandPlatform },
  deps: BandReportDeps,
): Promise<boolean> {
  const { sessionId, credential, identity, platform } = input;
  if (!sessionId || !identity || !normalizeBandSerial(identity.serial)) return false;
  const sent = deps.sent ?? defaultSent;
  const key = reportKey(sessionId, identity);
  if (sent.has(key) || inflight.has(key)) return false;
  inflight.add(key);
  const wait = deps.wait ?? sleep;
  const body: PutBandDeviceBody = { serial: identity.serial, platform, ...(identity.firmware ? { firmware: identity.firmware } : {}) };
  try {
    for (let attempt = 0; attempt <= REPORT_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await deps.put(sessionId, credential, body);
        sent.add(key);
        return true;
      } catch {
        if (attempt === REPORT_RETRY_DELAYS_MS.length) return false;
        await wait(REPORT_RETRY_DELAYS_MS[attempt]);
      }
    }
    return false;
  } finally {
    inflight.delete(key);
  }
}

/** 테스트·재입장용: 보고 이력 초기화. */
export function resetBandReportCache(sent: Set<string> = defaultSent): void {
  sent.clear();
  inflight.clear();
}
