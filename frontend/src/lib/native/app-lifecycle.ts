// 앱 생명주기 구독 (SDD-222 G1)
// 네이티브 앱에서만 @capacitor/app 의 appStateChange 를 구독한다.
// 웹은 no-op — 웹은 기존 visibilitychange 경로를 그대로 쓴다.
// 네이티브 리스너는 구독자 수와 무관하게 1개만 등록하고, 마지막 구독자가 해제되면 제거한다.

import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNativeApp } from './platform';

type Listener = () => void;

const resumeListeners = new Set<Listener>();
const pauseListeners = new Set<Listener>();
let nativeHandle: Promise<PluginListenerHandle> | null = null;

const notify = (listeners: Set<Listener>): void => {
  // 구독자 하나의 예외가 나머지 호출을 막지 않도록 각각 격리한다.
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error: unknown) {
      console.warn('[app-lifecycle] 구독자 처리 실패', error);
    }
  }
};

const ensureNativeListener = (): void => {
  if (nativeHandle) return;
  nativeHandle = App.addListener('appStateChange', ({ isActive }) => {
    notify(isActive ? resumeListeners : pauseListeners);
  });
};

const releaseNativeListenerIfIdle = (): void => {
  if (!nativeHandle || resumeListeners.size > 0 || pauseListeners.size > 0) return;
  const handle = nativeHandle;
  nativeHandle = null;
  void handle.then((h) => h.remove()).catch(() => undefined);
};

function subscribe(listeners: Set<Listener>, cb: Listener): () => void {
  if (!isNativeApp()) return () => undefined;
  listeners.add(cb);
  ensureNativeListener();
  return () => {
    listeners.delete(cb);
    releaseNativeListenerIfIdle();
  };
}

/** 포그라운드 복귀(isActive=true) 구독. 반환값은 해제 함수 */
export const subscribeAppResume = (cb: Listener): (() => void) => subscribe(resumeListeners, cb);

/** 백그라운드 전환(isActive=false) 구독. 반환값은 해제 함수 */
export const subscribeAppPause = (cb: Listener): (() => void) => subscribe(pauseListeners, cb);
