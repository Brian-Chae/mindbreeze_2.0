import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { getPlatform, isNativeApp } from '../native/platform';
import { apkErrorCode, getApkUpdater } from './apk-updater';
import { decideUpdate, fetchUpdateManifest, isDismissed, type UpdateDecision } from './update-config';

const DISMISS_KEY = 'mb.app.update.dismissed';

export type UpdatePhase = 'available' | 'downloading' | 'needs-permission' | 'installing' | 'error';

export interface AppUpdateState {
  notice: UpdateDecision | null;
  phase: UpdatePhase;
  progress: { received: number; total: number } | null;
  errorMessage: string;
  /** 이 빌드가 앱 안 설치를 지원하는지(미지원이면 다운로드 사이트를 연다). */
  installSupported: boolean;
  start: () => void;
  openSettings: () => void;
  dismiss: () => void;
}

const ERROR_TEXT: Record<string, string> = {
  hash_mismatch: '내려받은 파일이 올바르지 않아요. 다시 시도해 주세요.',
  download_failed: '다운로드에 실패했어요. 네트워크를 확인하고 다시 시도해 주세요.',
  install_failed: '설치 화면을 열지 못했어요. 다시 시도해 주세요.',
  bad_request: '업데이트 정보가 올바르지 않아요. 잠시 후 다시 시도해 주세요.',
};

/** 네이티브 앱에서만 최신 버전을 확인해 "새 버전 있음" 안내 정보를 돌려준다. 확인 실패는 조용히 무시. */
export function useAppUpdate(): AppUpdateState {
  const [notice, setNotice] = useState<UpdateDecision | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('available');
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [installSupported, setInstallSupported] = useState(false);
  const noticeRef = useRef<UpdateDecision | null>(null);
  noticeRef.current = notice;

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    void (async () => {
      try {
        const [manifest, info] = await Promise.all([fetchUpdateManifest(), App.getInfo()]);
        if (cancelled) return;
        const decision = decideUpdate(manifest, getPlatform(), info.build);
        if (!decision) return;
        let stored: string | null = null;
        try { stored = localStorage.getItem(DISMISS_KEY); } catch { /* noop */ }
        if (isDismissed(decision, stored)) return;
        if (decision.kind === 'android') {
          try {
            const cap = await getApkUpdater().getInstallCapability();
            if (!cancelled) setInstallSupported(cap.installSupported);
          } catch { /* 플러그인 없음 → 사이트 열기 폴백 */ }
        }
        if (!cancelled) setNotice(decision);
      } catch {
        /* 네트워크·플러그인 오류는 안내만 생략 */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fail = useCallback((err: unknown): void => {
    setErrorMessage(ERROR_TEXT[apkErrorCode(err)] ?? '업데이트에 실패했어요. 다시 시도해 주세요.');
    setPhase('error');
  }, []);

  const runAndroidInstall = useCallback(async (n: UpdateDecision): Promise<void> => {
    const updater = getApkUpdater();
    setProgress(null);
    const handle = await updater.addListener('progress', (e) => setProgress(e));
    try {
      const cap = await updater.getInstallCapability();
      if (!cap.canInstall) {
        setPhase('needs-permission');
        return;
      }
      setPhase('downloading');
      await updater.downloadAndInstall({ url: n.apkUrl, sha256: n.sha256, sizeBytes: n.sizeBytes });
      setPhase('installing');
    } catch (err) {
      if (apkErrorCode(err) === 'permission_required') setPhase('needs-permission');
      else fail(err);
    } finally {
      void handle.remove();
    }
  }, [fail]);

  const start = useCallback((): void => {
    const n = noticeRef.current;
    if (!n) return;
    if (n.kind === 'ios') {
      window.open(n.testflightUrl, '_blank', 'noopener');
      return;
    }
    if (!installSupported) {
      window.open('https://download.mindbreeze.looxidlabs.com', '_blank', 'noopener');
      return;
    }
    void runAndroidInstall(n);
  }, [installSupported, runAndroidInstall]);

  const openSettings = useCallback((): void => {
    void getApkUpdater().openInstallSettings().catch(fail);
  }, [fail]);

  // 설정 화면에서 돌아오면 설치 허용 여부를 다시 확인해 이어서 진행한다.
  useEffect(() => {
    if (!isNativeApp() || phase !== 'needs-permission') return;
    const sub = App.addListener('resume', () => {
      const n = noticeRef.current;
      if (!n) return;
      void getApkUpdater().getInstallCapability().then((cap) => {
        if (cap.canInstall) void runAndroidInstall(n);
      }).catch(() => { /* 다음 resume 에서 재확인 */ });
    });
    return () => { void sub.then((h) => h.remove()); };
  }, [phase, runAndroidInstall]);

  const dismiss = useCallback((): void => {
    const n = noticeRef.current;
    if (!n || n.forced) return;
    try { localStorage.setItem(DISMISS_KEY, n.dismissKey); } catch { /* noop */ }
    setNotice(null);
  }, []);

  return { notice, phase, progress, errorMessage, installSupported, start, openSettings, dismiss };
}
