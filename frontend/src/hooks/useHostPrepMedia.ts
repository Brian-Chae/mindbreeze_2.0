import { useEffect } from 'react';
import { useMediaCheck, type MediaCheck } from './useMediaCheck';

/** 점검→대기실은 한 스트림을 유지하고, 라이브·이탈·회차 변경 때 늦은 권한 응답까지 정리한다. */
export function useHostPrepMedia(enabled: boolean, sessionId: string | undefined): MediaCheck {
  const media = useMediaCheck();
  const { startMic, startCamera, stopMic, stopCamera } = media;
  useEffect(() => {
    if (!enabled) return;
    void startMic();
    void startCamera();
    return () => { stopMic(); stopCamera(); };
  }, [enabled, sessionId, startMic, startCamera, stopMic, stopCamera]);
  return media;
}
