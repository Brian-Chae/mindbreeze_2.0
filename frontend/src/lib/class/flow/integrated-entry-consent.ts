// SDD-303 — 기존 회차 동의 API만 사용하는 통합 화면 어댑터.
import { apiClient } from '../../api/client';
import { entryRequestOptions, getEntryState, setEegCollectionConsent, setReportChoice, setResearchConsent, type StoredEntry } from '../../api/class-flow';
import { EEG_COLLECTION_NOTICE_VERSION, RECORDING_NOTICE_VERSION } from './recording-consent';
import { RESEARCH_NOTICE_VERSION, reportNoticeVersion } from './member-prep';
import type { EntryStateDto } from '../../api/class-flow';

export interface EntryConsentValues { required: boolean; eeg: boolean; research: boolean; report: boolean }
export interface EntryConsentCheckpoint {
  required: boolean;
  eeg: boolean | null;
  research: boolean | null;
  report: boolean | null;
}
interface ConsentState {
  participant_id: string;
  recording_consented: boolean;
  recording_notice_version: string | null;
  eeg_collection_consented: boolean | null;
  eeg_notice_version: string | null;
}
interface ResearchState { participant_id: string; consented: boolean; notice_version: string | null }
export class EntryConsentTerminalError extends Error {
  readonly kind: 'closed' | 'cancelled';
  constructor(kind: 'closed' | 'cancelled') { super('종료되거나 취소된 클래스예요.'); this.kind = kind; }
}
function assertActiveState(state: EntryStateDto, entry: StoredEntry): void {
  if (state.status === 'completed' || state.status === 'cancelled') throw new EntryConsentTerminalError(state.status === 'completed' ? 'closed' : 'cancelled');
  if (state.participant_id !== entry.participantId) throw new Error('동의 참여자 정보가 일치하지 않아요.');
}
export async function checkIntegratedEntryActive(entry: StoredEntry): Promise<void> {
  assertActiveState(await getEntryState(entry.sessionId, entry.credential), entry);
}
export const emptyEntryConsentValues = (): EntryConsentValues => ({ required: false, eeg: false, research: false, report: false });
export async function loadIntegratedEntryConsent(entry: StoredEntry): Promise<{ values: EntryConsentValues; checkpoint: EntryConsentCheckpoint }> {
  const base = `/sessions/${encodeURIComponent(entry.sessionId)}`;
  const options = entryRequestOptions(entry.credential);
  // 종료 여부를 먼저 판단해 다른 동의 조회의 403이 종료 안내를 가리지 않게 한다.
  const state = await getEntryState(entry.sessionId, entry.credential);
  assertActiveState(state, entry);
  const [consent, research] = await Promise.all([
    apiClient.get<ConsentState>(`${base}/entry/consents`, options),
    entry.isGuest ? Promise.resolve<ResearchState>({ participant_id: entry.participantId ?? '', consented: false, notice_version: null }) : apiClient.get<ResearchState>(`${base}/research-consent`, options),
  ]);
  if (!entry.participantId || consent.participant_id !== entry.participantId || research.participant_id !== entry.participantId || state.participant_id !== entry.participantId) throw new Error('동의 참여자 정보가 일치하지 않아요.');
  const required = consent.recording_consented === true && consent.recording_notice_version === RECORDING_NOTICE_VERSION;
  const eeg = consent.eeg_notice_version === EEG_COLLECTION_NOTICE_VERSION && typeof consent.eeg_collection_consented === 'boolean' ? consent.eeg_collection_consented : null;
  const researchChoice = research.notice_version === RESEARCH_NOTICE_VERSION && typeof research.consented === 'boolean' ? research.consented : null;
  return {
    values: { required, eeg: eeg === true, research: researchChoice === true, report: state.report_included === true },
    // 리포트에는 별도 고지 확인 증빙이 필요하므로 제출 때 한 번 저장한다.
    checkpoint: { required, eeg, research: researchChoice, report: null },
  };
}

/** 각 성공을 기록해 부분 실패 재시도에서 같은 값만 중복 전송하지 않는다. */
export async function persistIntegratedEntryConsent(entry: StoredEntry, values: EntryConsentValues, checkpoint: EntryConsentCheckpoint, active: () => boolean, eegLocked: boolean): Promise<boolean> {
  if (!values.required || !entry.participantId || !entry.credential || !active()) return false;
  const base = `/sessions/${encodeURIComponent(entry.sessionId)}`;
  if (!checkpoint.required) {
    await apiClient.put(`${base}/entry/recording-consent`, { consented: true, notice_version: RECORDING_NOTICE_VERSION }, entryRequestOptions(entry.credential));
    checkpoint.required = true;
  }
  if (!active()) return false;
  // 자격 발급 시 계정 EEG 선택이 적용될 수 있으므로 사용자가 고른 값부터 확정한다.
  if (!eegLocked && entry.classInfo?.linkbandMode !== 'none' && checkpoint.eeg !== values.eeg) {
    await setEegCollectionConsent(entry.sessionId, entry.credential, { consented: values.eeg, noticeVersion: EEG_COLLECTION_NOTICE_VERSION });
    checkpoint.eeg = values.eeg;
  }
  if (!active()) return false;
  if (!entry.isGuest && checkpoint.research !== values.research) {
    await setResearchConsent(entry.sessionId, entry.credential, { participantId: entry.participantId, consented: values.research, noticeVersion: RESEARCH_NOTICE_VERSION });
    checkpoint.research = values.research;
  }
  if (!active()) return false;
  if (checkpoint.report !== values.report) {
    await setReportChoice(entry.sessionId, entry.credential, { participantId: entry.participantId, reportIncluded: values.report, noticeAcknowledged: true, noticeVersion: reportNoticeVersion(entry.classInfo?.sessionType) });
    checkpoint.report = values.report;
  }
  return active();
}
