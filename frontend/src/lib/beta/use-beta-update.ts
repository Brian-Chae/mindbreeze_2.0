import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { getPlatform, isNativeApp } from '../native/platform';
import { fetchBetaConfig, isOutdatedBuild } from './beta-config';

const DISMISS_KEY = 'mb.beta.update.dismissed';

export interface BetaUpdateNotice {
  latestLabel: string;
  landingUrl: string;
  dismissKey: string;
}

const publicBase = (): string =>
  ((import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) ?? '').replace(/\/+$/, '');

/** 네이티브 앱에서만 최신 베타 빌드를 확인해 "새 버전 있음" 안내 정보를 돌려준다. 실패는 조용히 무시. */
export function useBetaUpdate(): { notice: BetaUpdateNotice | null; dismiss: () => void } {
  const [notice, setNotice] = useState<BetaUpdateNotice | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    const base = publicBase();
    if (!base) return;
    let cancelled = false;
    void (async () => {
      try {
        const [cfg, info] = await Promise.all([fetchBetaConfig(base), App.getInfo()]);
        if (cancelled || !cfg || !cfg.updateBannerEnabled) return;
        const platform = getPlatform();
        const latest = platform === 'android' ? cfg.android.versionCode : platform === 'ios' ? cfg.ios.latestBuild : 0;
        if (!isOutdatedBuild(info.build, latest)) return;
        const label = platform === 'android' && cfg.android.versionName ? cfg.android.versionName : String(latest);
        const dismissKey = `${platform}:${latest}`;
        if (localStorage.getItem(DISMISS_KEY) === dismissKey) return;
        setNotice({ latestLabel: label, landingUrl: `${base}/beta`, dismissKey });
      } catch {
        /* 네트워크·플러그인 오류는 안내만 생략 */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = (): void => {
    if (notice) {
      try { localStorage.setItem(DISMISS_KEY, notice.dismissKey); } catch { /* noop */ }
    }
    setNotice(null);
  };
  return { notice, dismiss };
}
