/**
 * 개선 10: 클래스 오디오 트랙 API — 명상 가이드·BGM 카탈로그 + 회원별 볼륨 저장.
 *
 * GET /class/audio-tracks 는 무인증 공개다(회원·게스트도 상담사와 같은 소스를 받아야
 * 동기 재생이 성립한다 — 목록은 정적 메타데이터이며 스킵 인증으로 호출한다).
 * 볼륨은 서버에 저장하지 않는다(개인 청취 환경 — 브라우저에만 보관).
 */
import { apiClient } from './client';
import {
  AUDIO_VOLUME_STORAGE_KEY,
  DEFAULT_AUDIO_VOLUME,
  clampVolume,
  normalizeTrackList,
  type MeditationTrack,
} from '../class/audio-sync';

interface AudioTrackListDto {
  tracks?: unknown;
  count?: number;
}

let cachedTracks: MeditationTrack[] | null = null;
let inflight: Promise<MeditationTrack[]> | null = null;

/** GET /class/audio-tracks — 트랙 목록(무인증). 실패하면 빈 목록(재생 기능만 비활성) */
export async function getClassAudioTracks(force = false): Promise<MeditationTrack[]> {
  if (cachedTracks && !force) return cachedTracks;
  if (inflight && !force) return inflight;

  inflight = apiClient
    .get<AudioTrackListDto>('/class/audio-tracks', { skipAuth: true })
    .then((data) => {
      cachedTracks = normalizeTrackList(data);
      return cachedTracks;
    })
    .catch(() => {
      // 목록을 못 받아도 클래스 진행을 막지 않는다 — 트랙 선택 UI 만 비워진다
      return cachedTracks ?? [];
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** 캐시 초기화(테스트·재입장 시 최신 카탈로그 강제 반영) */
export function resetClassAudioTracksCache(): void {
  cachedTracks = null;
  inflight = null;
}

/** 목록에서 track_id 로 트랙 찾기 */
export function findTrack(
  tracks: readonly MeditationTrack[],
  trackId: string | null | undefined,
): MeditationTrack | null {
  if (!trackId) return null;
  return tracks.find((track) => track.track_id === trackId) ?? null;
}

/** 회원별 볼륨 읽기 — 저장값이 없거나 깨졌으면 기본값 */
export function readStoredVolume(): number {
  try {
    const raw = window.localStorage.getItem(AUDIO_VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_AUDIO_VOLUME;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampVolume(parsed) : DEFAULT_AUDIO_VOLUME;
  } catch {
    // 프라이빗 모드 등 localStorage 접근 불가 — 기본값으로 동작
    return DEFAULT_AUDIO_VOLUME;
  }
}

/** 회원별 볼륨 저장 — 실패는 무시(세션 진행을 막지 않는다) */
export function writeStoredVolume(value: number): void {
  try {
    window.localStorage.setItem(AUDIO_VOLUME_STORAGE_KEY, String(clampVolume(value)));
  } catch {
    // 저장 불가 환경 — 이번 세션에만 적용
  }
}
