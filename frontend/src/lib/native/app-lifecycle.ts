// 앱 생명주기 구독 (SDD-222 G1)
// 네이티브 앱에서만 @capacitor/app 의 appStateChange 를 구독한다.
// 웹은 no-op — 웹은 기존 visibilitychange 경로를 그대로 쓴다.
// 네이티브 리스너는 구독자 수와 무관하게 1개만 등록하고, 마지막 구독자가 해제되면 제거한다.

import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNativeApp } from './platform';

type Listener = () => void | Promise<void>;

interface Entry {
  cb: Listener;
  order: number;
}

/**
 * 복귀 처리 순서 — 훅 마운트 순서와 무관하게 "소켓 재연결 → raw flush → BLE 확인 → 화면 켜짐"
 * 순으로 호출되도록 order 가 작은 구독자부터 실행한다. (plan §3.1)
 */
export const RESUME_ORDER = { socket: 10, rawFlush: 20, ble: 30, screen: 40 } as const;
const DEFAULT_ORDER = 100;

const resumeListeners = new Set<Entry>();
const pauseListeners = new Set<Entry>();
let nativeHandle: Promise<PluginListenerHandle> | null = null;

const notify = (listeners: Set<Entry>): void => {
  // order 오름차순(같으면 등록 순). 구독자 하나의 예외(동기·비동기)가 나머지 호출을 막지 않도록 각각 격리한다.
  const sorted = [...listeners].sort((a, b) => a.order - b.order);
  for (const { cb } of sorted) {
    try {
      const result = cb();
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          console.warn('[app-lifecycle] 구독자 비동기 처리 실패', error);
        });
      }
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

function subscribe(listeners: Set<Entry>, cb: Listener, order: number): () => void {
  if (!isNativeApp()) return () => undefined;
  const entry: Entry = { cb, order };
  listeners.add(entry);
  ensureNativeListener();
  return () => {
    listeners.delete(entry);
    releaseNativeListenerIfIdle();
  };
}

/** 포그라운드 복귀(isActive=true) 구독. 반환값은 해제 함수 */
export const subscribeAppResume = (cb: Listener, order: number = DEFAULT_ORDER): (() => void) =>
  subscribe(resumeListeners, cb, order);

/** 백그라운드 전환(isActive=false) 구독. 반환값은 해제 함수 */
export const subscribeAppPause = (cb: Listener, order: number = DEFAULT_ORDER): (() => void) =>
  subscribe(pauseListeners, cb, order);
