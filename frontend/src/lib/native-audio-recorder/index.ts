// SDD-247 — 네이티브 수업 녹음 플러그인 래퍼. 웹/미지원이면 null 을 돌려 기존 MediaRecorder 경로를 쓰게 한다.
// 토큰 값은 이 모듈에서 로그·이벤트로 남기지 않는다.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { NativeAudioRecorderPlugin } from './types';

export * from './types';

let proxy: NativeAudioRecorderPlugin | null = null;

/** 네이티브 앱(Capacitor)에서만 플러그인 프록시를 돌려준다. 웹이면 null. */
export function getNativeAudioRecorder(): NativeAudioRecorderPlugin | null {
  let native: boolean;
  try {
    native = Capacitor.isNativePlatform();
  } catch {
    native = false;
  }
  if (!native) return null;
  if (!proxy) proxy = registerPlugin<NativeAudioRecorderPlugin>('NativeAudioRecorder');
  return proxy;
}

/**
 * 네이티브 녹음을 쓸 수 있으면 플러그인을, 아니면 null 을 돌려준다.
 * (네이티브 + 플러그인 존재 + 플러그인 isAvailable().available — Android API 29 미만 등은 플러그인이 false)
 */
export async function resolveNativeAudioRecorder(): Promise<NativeAudioRecorderPlugin | null> {
  const plugin = getNativeAudioRecorder();
  if (!plugin) return null;
  try {
    const res = await plugin.isAvailable();
    return res?.available ? plugin : null;
  } catch {
    // 플러그인 미등록·호출 실패 → 기존 경로로 폴백
    return null;
  }
}
