// 개선 10: 명상 가이드·BGM 동기 재생 — 순수 계약 · 서버 시계 보정 · 동기 판정.
//
// 상담사가 로컬에서 트는 가이드 음성·BGM 을 회원 화면에서 **같은 소스·같은 위치**로
// 재생한다. 서버(`/session-live`)가 재생 명령을 세션 룸에 브로드캐스트하면 회원은
//   현재 위치 = position_sec + (서버 현재 시각 - server_ts)
// 로 정렬한다. 서버·회원의 로컬 시계가 다르므로 server_ts_ms 와 **수신 시각**의 차이를
// 표본으로 모아 시계 오차(clock offset)를 추정한다 — 지연이 가장 작았던 표본(최댓값)이
// 실제 오차에 가장 가깝다(지연은 항상 0 이상).
//
// 볼륨은 서버 payload 에 없다 — 회원별 개별 설정(개인 헤드셋/스피커 환경이 다르다).

/** WS 이벤트명 — 백엔드 `/session-live` 네임스페이스와 동일 계약 */
export const CLASS_AUDIO_SYNC_EVENT = 'class:audio_sync';

/** 서버가 허용하는 재생 제어 액션 — 그 외 값은 서버가 무시한다(클라이언트도 선검증) */
export const AUDIO_SYNC_ACTIONS = ['play', 'pause', 'seek', 'stop'] as const;

export type AudioSyncAction = (typeof AUDIO_SYNC_ACTIONS)[number];

/** 트랙 종류 — 배경음 / 가이드 음성 */
export type AudioTrackKind = 'bgm' | 'guide';

/** 소스 종류 — 외부 URL 자산 / 내장 톤(무자산) */
export type AudioSourceKind = 'url' | 'tone';

/** 내장 톤 소스 — 모든 클라이언트가 같은 주파수·파형을 만들어 "동일 소스"가 된다 */
export interface AudioToneSpec {
  freq_hz: number;
  waveform: 'sine' | 'triangle' | 'square' | 'sawtooth';
  gain: number;
  detune_hz?: number | null;
  pulse_sec?: number | null;
}

/** 재생 가능한 트랙 1건 (GET /class/audio-tracks 응답 항목) */
export interface MeditationTrack {
  track_id: string;
  title: string;
  kind: AudioTrackKind;
  url: string | null;
  duration_sec: number | null;
  synth: AudioToneSpec | null;
  description: string;
  loop: boolean;
  source: AudioSourceKind;
}

/** 서버 → 클라이언트: 재생 타임코드 브로드캐스트 */
export interface AudioSyncEvent {
  session_id?: string;
  action: AudioSyncAction;
  track_id: string | null;
  /** 명령 시점의 재생 위치(초) */
  position_sec: number;
  /** 서버 시각(ISO) — 사람이 읽는 값 */
  server_ts: string;
  /** 서버 시각(epoch ms) — 시계 오차 보정 기준 */
  server_ts_ms: number;
  /** 세션별 명령 순번 — 역순 도착(네트워크 재정렬) 방어 */
  revision: number;
}

/** 클라이언트 → 서버: 재생 제어 emit payload */
export interface AudioSyncEmit {
  session_id: string;
  action: AudioSyncAction;
  track_id: string | null;
  position_sec: number;
}

/** 위치 재조정 임계(초) — 이보다 벌어지면 완전 재시킹한다(근사 동기 목표) */
export const DRIFT_TOLERANCE_SEC = 0.35;

/** 상담사 정기 재동기(heartbeat) 주기(ms) — 늦은 입장자·드리프트를 계속 수렴시킨다 */
export const AUDIO_SYNC_HEARTBEAT_MS = 5_000;

/** 기본 볼륨(0~1) — 회원이 각자 조절한다 */
export const DEFAULT_AUDIO_VOLUME = 0.6;

/** 볼륨 저장 키(개별 설정 유지) */
export const AUDIO_VOLUME_STORAGE_KEY = 'mb.class.audio.volume';

export function isAudioSyncAction(value: unknown): value is AudioSyncAction {
  return typeof value === 'string' && (AUDIO_SYNC_ACTIONS as readonly string[]).includes(value);
}

/** 재생 위치를 0 이상 duration 이하로 자른다(duration 없으면 상한 없음) */
export function clampPosition(sec: number, durationSec: number | null = null): number {
  if (!Number.isFinite(sec)) return 0;
  const clamped = Math.max(0, sec);
  if (durationSec !== null && Number.isFinite(durationSec) && durationSec > 0) {
    return Math.min(clamped, durationSec);
  }
  return clamped;
}

/** 볼륨 0~1 정규화 — NaN/범위 밖은 기본값으로 되돌린다 */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUDIO_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * 서버 payload 를 검증·정규화한다. 계약을 벗어나면 null(호출측이 무시).
 * 서버가 이미 정규화하지만, 구버전/타 구현 payload 가 회원 화면을 깨뜨리지 않게 한다.
 */
export function parseAudioSyncEvent(raw: unknown): AudioSyncEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!isAudioSyncAction(data.action)) return null;

  const rawPosition = data.position_sec;
  const position = typeof rawPosition === 'number' && Number.isFinite(rawPosition) ? rawPosition : 0;

  const tsMs = data.server_ts_ms;
  // server_ts_ms 가 없으면 서버 시각 보정이 불가능하다 — ISO 문자열로 대체 시도
  let serverTsMs = typeof tsMs === 'number' && Number.isFinite(tsMs) ? tsMs : NaN;
  if (!Number.isFinite(serverTsMs)) {
    const iso = data.server_ts;
    const parsed = typeof iso === 'string' ? Date.parse(iso) : NaN;
    if (!Number.isFinite(parsed)) return null;
    serverTsMs = parsed;
  }

  const trackId = data.track_id;
  const revision = data.revision;

  return {
    ...(typeof data.session_id === 'string' ? { session_id: data.session_id } : {}),
    action: data.action,
    track_id: typeof trackId === 'string' && trackId ? trackId : null,
    position_sec: clampPosition(position),
    server_ts: typeof data.server_ts === 'string' ? data.server_ts : new Date(serverTsMs).toISOString(),
    server_ts_ms: serverTsMs,
    revision: typeof revision === 'number' && Number.isFinite(revision) ? revision : 0,
  };
}

/** 트랙 1건 검증 — 목록 응답을 그대로 믿지 않는다(재생 불가 트랙은 걸러진다) */
export function isMeditationTrack(raw: unknown): raw is MeditationTrack {
  if (!raw || typeof raw !== 'object') return false;
  const t = raw as Record<string, unknown>;
  if (typeof t.track_id !== 'string' || !t.track_id) return false;
  if (typeof t.title !== 'string' || !t.title) return false;
  if (t.kind !== 'bgm' && t.kind !== 'guide') return false;

  const url = t.url;
  const synth = t.synth;
  const hasUrl = typeof url === 'string' && url.length > 0;
  const hasSynth = Boolean(synth) && typeof synth === 'object';
  // 소스가 하나도 없으면 재생할 수 없다 — 화면에 올리지 않는다
  if (!hasUrl && !hasSynth) return false;

  return true;
}

/** 목록 응답(tracks 배열)을 검증해 재생 가능한 트랙만 남긴다 */
export function normalizeTrackList(raw: unknown): MeditationTrack[] {
  const container = raw as { tracks?: unknown } | null | undefined;
  const list = container?.tracks;
  if (!Array.isArray(list)) return [];
  return list.filter(isMeditationTrack);
}

/** 트랙의 실제 재생 소스 종류 — url 우선(자산이 있으면 그걸 쓴다) */
export function trackSourceOf(track: MeditationTrack): AudioSourceKind {
  return track.url ? 'url' : 'tone';
}

/** 서버 시계 오차 표본(server_ts_ms - 수신 시각). 지연이 작았던 표본일수록 실제 오차에 가깝다 */
export interface ClockSamples {
  samples: number[];
}

/** 시계 오차 표본 보관 개수 — 오래된(지연이 컸던) 표본은 밀어낸다 */
export const CLOCK_SAMPLE_CAPACITY = 16;

export function emptyClockSamples(): ClockSamples {
  return { samples: [] };
}

/** 수신 시각 기준 표본을 추가한다(불변 — 새 객체 반환) */
export function recordClockSample(
  state: ClockSamples,
  event: AudioSyncEvent,
  receivedAtMs: number,
  capacity: number = CLOCK_SAMPLE_CAPACITY,
): ClockSamples {
  if (!Number.isFinite(receivedAtMs)) return state;
  const sample = event.server_ts_ms - receivedAtMs;
  const samples = [...state.samples, sample];
  if (samples.length > capacity) {
    samples.splice(0, samples.length - capacity);
  }
  return { samples };
}

/**
 * 추정 시계 오차(ms): 서버시계 = 로컬시계 + offset.
 * 표본이 없으면 0(보정 없음) — 표본 중 **최댓값**을 쓴다(지연 최소 표본 = NTP 의 min-delay 원리).
 */
export function clockOffsetMs(state: ClockSamples): number {
  if (state.samples.length === 0) return 0;
  return state.samples.reduce((max, value) => (value > max ? value : max), state.samples[0]);
}

/**
 * 지금 시점의 목표 재생 위치(초).
 * - play: 명령 시점 위치 + 서버 기준 경과 시간(그래서 늦게 입장한 회원도 현재 위치로 합류한다)
 * - pause/seek/stop: 명령이 지시한 위치 그대로(경과 시간을 더하면 안 된다)
 */
export function targetPositionSec(
  event: AudioSyncEvent,
  nowClientMs: number,
  offsetMs: number,
): number {
  if (event.action !== 'play') {
    return clampPosition(event.action === 'stop' ? 0 : event.position_sec);
  }
  const elapsedSec = (nowClientMs + offsetMs - event.server_ts_ms) / 1000;
  return clampPosition(event.position_sec + Math.max(0, elapsedSec));
}

/** 두 위치의 차이(초, 절댓값) */
export function driftSec(currentSec: number, targetSec: number): number {
  if (!Number.isFinite(currentSec) || !Number.isFinite(targetSec)) return 0;
  return Math.abs(currentSec - targetSec);
}

/** 재시킹이 필요한가 — 임계 이내면 그대로 두고(들리지 않는 미세 조정 생략) 벌어지면 맞춘다 */
export function needsResync(
  currentSec: number,
  targetSec: number,
  toleranceSec: number = DRIFT_TOLERANCE_SEC,
): boolean {
  return driftSec(currentSec, targetSec) > toleranceSec;
}

/** 재생 제어 emit payload (상담사 → 서버) */
export function buildAudioSyncEmit(
  sessionId: string,
  action: AudioSyncAction,
  trackId: string | null,
  positionSec: number,
): AudioSyncEmit {
  return {
    session_id: sessionId,
    action,
    track_id: trackId,
    position_sec: clampPosition(positionSec),
  };
}

/** 초 → mm:ss (회원·상담사 패널 공용 표기) */
export function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSec) ? totalSec : 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** 트랙 길이 표기 — 내장 톤(길이 없음)은 "무한" */
export function formatTrackDuration(durationSec: number | null): string {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) return '무한';
  return formatClock(durationSec);
}

/** 재생 상태 표기 — 상담사·회원 패널 공용 */
export function formatPlaybackState(playing: boolean, hasTrack: boolean): string {
  if (!hasTrack) return '대기';
  return playing ? '재생 중' : '일시정지';
}
