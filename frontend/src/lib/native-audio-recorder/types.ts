// SDD-247 — 네이티브 수업 녹음 브리지 계약 (JS ↔ iOS/Android Capacitor 플러그인 `NativeAudioRecorder`)
// 계약 변경은 plan.md §2 표와 이 파일을 함께 고친다. 트랙(BE/FE/iOS/Android)은 이 파일을 수정하지 않는다.
// 토큰 값은 이벤트·getStatus 결과 어디에도 담지 않는다.

/** 청크 길이(ms) — 네이티브·웹 공통 */
export const NATIVE_AUDIO_CHUNK_MS = 5000;
/** 네이티브 청크 파일 형식: AAC-LC m4a(audio/mp4), 청크마다 독립 재생 가능 */
export const NATIVE_AUDIO_MIME = 'audio/mp4';

export type NativeRecorderState = 'idle' | 'recording' | 'paused' | 'micOff' | 'stopping' | 'stopped' | 'error';

export interface NativeAudioStartOptions {
  sessionId: string;
  /** 예: https://dev.example/api/v1 (끝 슬래시 없음). 업로드 URL = `${apiBase}/sessions/${sessionId}/audio/chunk` */
  apiBase: string;
  /** 인계 시점 access 토큰 — 네이티브가 자체 저장소(Keystore/Keychain)에 봉인한다 */
  accessToken: string;
  /** refresh 토큰(앱 로컬 보관분). 네이티브가 백그라운드에서 `POST {apiBase}/auth/refresh` 로 직접 갱신(회전 헤더 X-MB-Refresh-Token 반영) */
  refreshToken: string;
  /** 5000 고정(검증용으로 노출) */
  chunkMs: number;
  /** 첫 청크 인덱스(새 녹음=0, 같은 세션 이어 녹음=서버 total_chunks 이상) */
  startChunkIndex: number;
}

export interface NativeAudioStatus {
  state: NativeRecorderState;
  sessionId: string | null;
  /** 다음에 만들 청크 인덱스 */
  nextChunkIndex: number;
  /** 업로드 완료된 청크 수(이번 start 이후) */
  uploadedCount: number;
  /** 로컬 큐에 남은(미업로드) 청크 수 */
  pendingCount: number;
  /** 마지막 업로드 성공 청크 인덱스(없으면 -1) */
  lastUploadedIndex: number;
}

export interface NativeAudioStopResult {
  /** 마지막 청크까지 만들었고, 그 중 서버 업로드가 끝나지 않은 개수(0이면 JS 가 바로 /audio/stop 호출) */
  pendingCount: number;
  uploadedCount: number;
  lastChunkIndex: number;
}

export type NativeAudioErrorCode =
  | 'permission_denied' | 'session_interrupted' | 'audio_engine_failed'
  | 'auth_expired' | 'upload_failed' | 'disk_full' | 'unsupported';

export type NativeAudioEvent =
  | { event: 'chunkUploaded'; sessionId: string; chunkIndex: number; sizeBytes: number; uploadedCount: number; pendingCount: number }
  | { event: 'stateChanged'; sessionId: string | null; state: NativeRecorderState; reason?: 'user' | 'interruption' | 'route_change' | 'app_restart' | 'system' }
  | { event: 'error'; sessionId: string | null; code: NativeAudioErrorCode; message: string; recoverable: boolean };

export interface NativeAudioListenerHandle { remove: () => Promise<void> }

export interface NativeAudioRecorderPlugin {
  /** 네이티브 녹음 사용 가능 여부. 웹/미지원(예: 초기화 실패)이면 available=false → 기존 MediaRecorder 경로 */
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  start(opts: NativeAudioStartOptions): Promise<NativeAudioStatus>;
  stop(): Promise<NativeAudioStopResult>;
  pause(): Promise<NativeAudioStatus>;
  resume(): Promise<NativeAudioStatus>;
  /** 마이크 오프=false: 캡처 중단(해당 구간 녹음 제외, 인덱스는 진행하지 않음). true: 이어서 캡처 */
  setMicEnabled(opts: { enabled: boolean }): Promise<NativeAudioStatus>;
  getStatus(): Promise<NativeAudioStatus>;
  /** JS 가 토큰을 새로 받았을 때(포그라운드) 네이티브 저장소를 동기화 — 회전 충돌 방지 */
  updateCredentials(opts: { accessToken: string; refreshToken: string }): Promise<void>;
  addListener(eventName: 'chunkUploaded' | 'stateChanged' | 'error', cb: (ev: NativeAudioEvent) => void): Promise<NativeAudioListenerHandle>;
}
