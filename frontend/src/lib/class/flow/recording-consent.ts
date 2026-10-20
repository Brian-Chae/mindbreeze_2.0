// SDD-220 F1 — 회차별 녹음·녹화 필수 동의 문구·판정. 서버가 최종 검증하며(403 RECORDING_CONSENT_REQUIRED) 이 파일은 안내용이다.
import { ApiError } from '../../api/client';
import { apiErrorCode } from '../../api/auth';

/** 고지 문구 버전(서버 증빙용, 최대 20자). 문구가 바뀌면 올린다 */
export const RECORDING_NOTICE_VERSION = 'rec-1';
export const EEG_COLLECTION_NOTICE_VERSION = 'eeg-1';

export const RECORDING_HEADLINE = '이 클래스는 녹음·녹화될 수 있어요';

/** 녹음·녹화 안내 줄. AI 기능이 꺼져 있으면 "AI 기록" 문구를 쓰지 않고 "녹음"만 남긴다. */
export function recordingNoticeLines(opts: { aiEnabled: boolean; online: boolean }): string[] {
  const { aiEnabled, online } = opts;
  const lines = [
    online
      ? aiEnabled ? '음성을 녹음하고 AI가 기록지를 만들어요' : '음성을 녹음해 클래스 기록으로 보관해요'
      : aiEnabled ? '현장 대화를 녹음하고 AI가 기록지를 만들어요' : '현장 대화를 녹음해 클래스 기록으로 보관해요',
  ];
  if (online) lines.push('카메라를 켜면 영상도 녹화될 수 있어요');
  lines.push('리포트 반영이나 연구 활용에 동의하지 않아도 클래스에는 참여할 수 있어요');
  return lines;
}

export const RECORDING_CHECK_LABEL = '녹음·녹화에 동의해요 (필수)';

/** 서버가 녹음·녹화 동의 누락으로 거부했는지 */
export function isRecordingConsentRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && apiErrorCode(error) === 'RECORDING_CONSENT_REQUIRED';
}
