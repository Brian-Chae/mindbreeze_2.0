// ApkUpdater 네이티브 플러그인 프록시 (SDD-259, Android 전용)
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface ApkCapability {
  /** 이 빌드가 패키지 설치 권한(REQUEST_INSTALL_PACKAGES)을 포함하는지(sideload 빌드). */
  installSupported: boolean;
  /** 이 앱의 "출처를 알 수 없는 앱 설치" 허용 여부. */
  canInstall: boolean;
}

export interface ApkProgressEvent {
  received: number;
  total: number;
}

export type ApkErrorCode = 'not_supported' | 'permission_required' | 'bad_request' | 'download_failed' | 'hash_mismatch' | 'install_failed';

export interface ApkUpdaterPlugin {
  getInstallCapability(): Promise<ApkCapability>;
  downloadAndInstall(opts: { url: string; sha256: string; sizeBytes?: number }): Promise<{ status: 'installing' }>;
  openInstallSettings(): Promise<void>;
  cancel(): Promise<void>;
  addListener(event: 'progress', cb: (e: ApkProgressEvent) => void): Promise<PluginListenerHandle>;
}

let proxy: ApkUpdaterPlugin | null = null;
export function getApkUpdater(): ApkUpdaterPlugin {
  proxy ??= registerPlugin<ApkUpdaterPlugin>('ApkUpdater');
  return proxy;
}

/** 플러그인 오류에서 코드를 꺼낸다(Capacitor 는 reject code 를 err.code 로 준다). */
export function apkErrorCode(err: unknown): ApkErrorCode | 'unknown' {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? (code as ApkErrorCode) : 'unknown';
}
