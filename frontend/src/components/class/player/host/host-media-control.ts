// SDD-208 H4 — 상담사 마이크·카메라 제어 규칙.
// 마이크 끄기 = LiveKit 마이크 off + AI 기록(audio recorder) 일시정지 + 영상 녹화의 오디오 트랙 무음. 뇌파(밴드 업로드)는 마이크와 독립이라 여기서 건드리지 않는다.
//
// [실측 2026-10-16, Chrome + 가짜 미디어 기기] MediaRecorder 가 도는 중에 stream 의 오디오 트랙 enabled=false 로 바꾸면
// 그 구간 녹음 오디오가 정확히 무음(RMS 0)이 되고 영상 청크는 끊기지 않으며, enabled=true 로 되돌리면 소리가 복구된다.
// 그래서 withAudio 가 훅 생성 시점에 고정된 useVideoRecorder 를 고치지 않고 stream 의 오디오 트랙만 토글한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecorderState } from '../../../../hooks/useAudioRecorder';
import type { VideoRecorderState } from '../../../../hooks/useVideoRecorder';
import type { CamUi, MicUi } from '../../../../lib/class/player-case';

export type MediaFailureKind = 'mic' | 'camera';
export type MediaFailureReason = 'denied' | 'notfound' | 'other';

export interface MediaControlRecorder {
  state: RecorderState;
  pause: () => void;
  resume: () => void;
}

export interface MediaControlVideoRecorder {
  state: VideoRecorderState;
  stream: MediaStream | null;
  pause: () => void;
  resume: () => void;
}

interface UseHostMediaControlOptions {
  /** 입장 전에 고른 마이크·카메라 사용 여부 — 진행 중 토글의 시작값 */
  initialMicOn: boolean;
  initialCamOn: boolean;
  recorder: MediaControlRecorder;
  videoRecorder: MediaControlVideoRecorder;
}

export function useHostMediaControl({ initialMicOn, initialCamOn, recorder, videoRecorder }: UseHostMediaControlOptions): {
  micOn: boolean;
  camOn: boolean;
  toggleMic: () => void;
  toggleCam: () => void;
} {
  const [micOn, setMicOn] = useState(initialMicOn);
  const [camOn, setCamOn] = useState(initialCamOn);
  const latest = useRef({ recorder, videoRecorder });
  useEffect(() => {
    latest.current = { recorder, videoRecorder };
  });
  // 마이크/카메라를 끄면서 우리가 멈춘 녹음만 되돌려 재개한다(사용자가 직접 멈춘 녹음은 그대로 둔다)
  const micPausedRecording = useRef(false);
  const camPausedRecording = useRef(false);

  useEffect(() => {
    if (recorder.state !== 'paused') micPausedRecording.current = false;
  }, [recorder.state]);
  useEffect(() => {
    if (videoRecorder.state !== 'paused') camPausedRecording.current = false;
  }, [videoRecorder.state]);

  // 영상 녹화 스트림의 오디오 트랙 — 카메라 전환으로 스트림이 바뀌어도 현재 마이크 상태를 다시 적용한다
  useEffect(() => {
    videoRecorder.stream?.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [micOn, videoRecorder.stream]);

  // 부수효과(녹음 pause/resume)를 상태 업데이터 밖에서 한 번만 실행하려고 현재 값을 ref 로도 들고 있는다
  const micOnRef = useRef(initialMicOn);
  const camOnRef = useRef(initialCamOn);

  const toggleMic = useCallback(() => {
    const next = !micOnRef.current;
    micOnRef.current = next;
    setMicOn(next);
    const { recorder: rec } = latest.current;
    if (!next) {
      if (rec.state === 'recording') {
        rec.pause();
        micPausedRecording.current = true;
      }
    } else if (micPausedRecording.current) {
      micPausedRecording.current = false;
      rec.resume();
    }
  }, []);

  const toggleCam = useCallback(() => {
    const next = !camOnRef.current;
    camOnRef.current = next;
    setCamOn(next);
    const { videoRecorder: video } = latest.current;
    if (!next) {
      if (video.state === 'recording') {
        video.pause();
        camPausedRecording.current = true;
      }
    } else if (camPausedRecording.current) {
      camPausedRecording.current = false;
      video.resume();
    }
  }, []);

  return { micOn, camOn, toggleMic, toggleCam };
}

/** 마이크 UI 상태 — 권한 실패나 녹음기 오류가 켜짐/꺼짐보다 우선한다 */
export function resolveMicUi(input: { micOn: boolean; failure: MediaFailureReason | null; recorderState: RecorderState }): MicUi {
  if (input.failure === 'denied' || input.recorderState === 'error') return 'denied';
  return input.micOn ? 'on' : 'off';
}

export function resolveCamUi(input: { camOn: boolean; failure: MediaFailureReason | null; videoState: VideoRecorderState }): CamUi {
  if (input.failure === 'notfound') return 'nodevice';
  if (input.failure === 'denied' || input.videoState === 'error') return 'denied';
  return input.camOn ? 'on' : 'off';
}
