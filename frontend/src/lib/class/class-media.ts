// SDD-209 T2b — 기기 점검(내 영상·소리) 순수 로직. 회원 FM06d · 상담사 FH05 가 함께 쓴다.
// 대기실(ClassWaitingRoom)·상담사 프리뷰(SessionPreJoinPreview)에 복제돼 있던 RMS 계산과 오류 분류를 한 곳으로 모은다.

/** 장치 상태. 권한 거부(denied)·장치 없음(nodevice)·사용 중(inuse)을 구분한다 */
export type MediaDeviceUi = 'pending' | 'on' | 'off' | 'denied' | 'nodevice' | 'inuse' | 'unsupported';

export type MediaFailureUi = 'denied' | 'nodevice' | 'inuse';

/** getUserMedia 오류 → 상태. 알 수 없는 오류는 "쓸 수 없음"으로 본다 */
export function classifyMediaError(err: unknown): MediaFailureUi {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'nodevice';
  return 'inuse';
}

/** 시간 영역 바이트(128 중심) → RMS(0~1) */
export function rmsFromTimeDomain(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

/** 현행 대기실 레벨 식(ClassWaitingRoom) 그대로: min(1, RMS×3) */
export function levelFromRms(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, rms * 3);
}

export const RING_SEGMENTS = 5;

/** 5단계 링: ceil(level×5), 0..5 */
export function ringSteps(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(RING_SEGMENTS, Math.ceil(level * RING_SEGMENTS));
}

/** `조용해요` 임계(최근 구간 피크). 잠정값 = 링 1단계 상한 — 실기기 실측 후 확정(verify §16-2) */
export const MIC_QUIET_LEVEL = 0.2;
/** 피크를 보는 최근 구간(ms) */
export const MIC_QUIET_WINDOW_MS = 3000;

export function classifyMicQuality(recentPeak: number): 'quiet' | 'normal' {
  return recentPeak < MIC_QUIET_LEVEL ? 'quiet' : 'normal';
}

export interface LevelSample {
  t: number;
  level: number;
}

/** nowMs 기준 최근 창 안의 최대 레벨. 창 안에 표본이 없으면 null(판정 보류) */
export function peakInWindow(samples: readonly LevelSample[], nowMs: number, windowMs: number = MIC_QUIET_WINDOW_MS): number | null {
  let peak: number | null = null;
  for (const s of samples) {
    if (nowMs - s.t > windowMs) continue;
    if (peak === null || s.level > peak) peak = s.level;
  }
  return peak;
}

export interface MicOffWarningInput {
  place: 'online' | 'offline';
  micState: MediaDeviceUi;
  /** 사용자가 마이크를 켜 두려고 하는가(토글 상태) */
  micWanted: boolean;
}

/** 클래스 열기·시작 전 마이크 꺼짐 확인이 필요한가. 오프라인은 마이크 UI 가 없어 해당 없음 */
export function needsMicOffWarning(input: MicOffWarningInput): boolean {
  if (input.place === 'offline') return false;
  return !(input.micState === 'on' && input.micWanted);
}

/** 마이크 칩 라벨 — 상세 메시지와 같은 상태에서 만든다 */
export function micChipLabel(state: MediaDeviceUi, quiet: boolean): string {
  switch (state) {
    case 'on':
      return quiet ? '조용해요' : '정상';
    case 'denied':
      return '권한 필요';
    case 'nodevice':
      return '마이크를 찾지 못했어요';
    case 'inuse':
      return '마이크를 쓸 수 없어요';
    case 'unsupported':
      return '지원 안 됨';
    case 'pending':
      return '확인 중';
    case 'off':
      return '꺼짐';
  }
}

/** 장치별 상세 안내(시안 문구) */
export function mediaDeviceMessage(device: '마이크' | '카메라', state: MediaDeviceUi): string {
  if (device === '마이크') {
    switch (state) {
      case 'denied':
        return '마이크 권한이 꺼져 있어요. 마이크 없이도 입장할 수 있어요. 입장한 뒤에 다시 켤 수 있어요.';
      case 'nodevice':
        return '마이크를 찾지 못했어요. 장치가 연결됐는지 확인해 주세요. 마이크 없이도 입장할 수 있어요.';
      case 'inuse':
        return '마이크를 쓸 수 없어요. 다른 앱이 쓰고 있는지 확인해 주세요. 마이크 없이도 입장할 수 있어요.';
      case 'unsupported':
        return '이 브라우저에서는 마이크와 카메라를 쓸 수 없어요. Chrome 또는 Edge에서 열어 주세요.';
      default:
        return '';
    }
  }
  switch (state) {
    case 'denied':
      return '카메라 권한이 꺼져 있어요. 카메라 없이도 참여할 수 있어요.';
    case 'nodevice':
      return '카메라를 찾지 못했어요. 카메라 없이도 참여할 수 있어요.';
    case 'inuse':
      return '카메라를 쓸 수 없어요. 카메라 없이도 참여할 수 있어요.';
    case 'unsupported':
      return '이 브라우저에서는 카메라를 쓸 수 없어요.';
    default:
      return '';
  }
}
