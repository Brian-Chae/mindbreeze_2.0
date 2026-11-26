// SDD-335 — 수업 입장 전 최소 앱 버전 확인. 네이티브 앱에서만 동작하고, 조회 실패·정보 없음은 통과(막지 않는다).
import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { getPlatform, isNativeApp } from '../native/platform';
import { APP_STORE_URL, PLAY_STORE_URL, fetchUpdateManifest, isBelowMinVersion } from './update-config';

export interface MinVersionState {
  /** 확인이 끝나기 전에는 false — 화면을 막지 않고 먼저 보여 준다 */
  blocked: boolean;
  installed: string;
  required: string;
  storeUrl: string;
}

const PASS: MinVersionState = { blocked: false, installed: '', required: '', storeUrl: '' };

export function storeUrlFor(platform: string): string {
  return platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
}

export function useMinAppVersion(): MinVersionState {
  const [state, setState] = useState<MinVersionState>(PASS);
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [manifest, info] = await Promise.all([fetchUpdateManifest(), App.getInfo()]);
        if (cancelled || !manifest?.minAppVersion) return;
        if (isBelowMinVersion(info.version, manifest.minAppVersion)) {
          setState({ blocked: true, installed: info.version, required: manifest.minAppVersion, storeUrl: storeUrlFor(getPlatform()) });
        }
      } catch { /* 확인 실패는 입장을 막지 않는다 */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}
