// SDD-262: 회원 본인 "내 데이터 저장 현황" 순수 로직. 서버 수신 기준만 다룬다.
// 완료·보증·100%·점수·좋음/나쁨 표현을 만들지 않는다. 기대 수를 모르므로 '수신 N창'으로만 표기한다.

export interface MyFeatureSummary {
  session_id: string; participant_id: string; total_count: number; streams: unknown[]; updated_at: string | null;
}
export interface MyRawStream {
  stream_id: string; segment_id: string; signal_type: string; uploaded: number; pending: number; failed: number;
  min_index: number | null; max_index: number | null; missing_ranges: number[][]; truncated: boolean;
}
export interface MyRawSummary {
  session_id: string; participant_id: string; total: number; uploaded: number; pending: number; failed: number;
  streams: MyRawStream[]; updated_at: string | null;
}

export type MyStatusKind = 'needs_attention' | 'uploading' | 'received' | 'no_data';
export const MY_STATUS_LABEL: Record<MyStatusKind, string> = {
  needs_attention: '확인 필요',
  uploading: '업로드 중',
  received: '수신 확인 · 전체 대조 미확인',
  no_data: '수신 기록 없음',
};
export const MY_STATUS_ICON: Record<MyStatusKind, string> = { needs_attention: '!', uploading: '◷', received: '↓', no_data: '−' };
export const MY_STATUS_HINT: Record<MyStatusKind, string> = {
  needs_attention: '서버가 받지 못한 원시 데이터 조각이 있어요. 앱을 켠 채 네트워크를 확인하고 잠시 뒤 다시 확인해 주세요.',
  uploading: '서버에 등록된 원시 데이터를 올리는 중이에요. 잠시 뒤 다시 확인해 주세요.',
  received: '서버가 받은 기록이 있어요. 기대하는 전체 양을 알 수 없어 전부 도착했는지는 확인하지 못해요.',
  no_data: '이 회차에서 서버가 받은 기록이 없어요. LINK BAND를 착용하지 않았거나 마이크를 끈 경우에는 기록이 없는 것이 정상이에요.',
};

export type SignalType = 'eeg' | 'ppg' | 'acc';
export const MY_SIGNAL_LABEL: Record<SignalType, string> = { eeg: 'EEG', ppg: 'PPG', acc: 'ACC' };
const SIGNALS: readonly SignalType[] = ['eeg', 'ppg', 'acc'];

export interface MySignalCounts { signal: SignalType; uploaded: number; pending: number; failed: number }
export interface MyStatusModel {
  kind: MyStatusKind;
  featureWindows: number;
  raw: { registered: number; uploaded: number; pending: number; failed: number };
  signals: MySignalCounts[];
  lastReceivedAt: string | null;
}

export function buildMyStatus(feature: MyFeatureSummary, raw: MyRawSummary): MyStatusModel {
  const signals: MySignalCounts[] = SIGNALS.map((signal) => raw.streams
    .filter((s) => s.signal_type === signal)
    .reduce<MySignalCounts>((acc, s) => ({ signal, uploaded: acc.uploaded + s.uploaded, pending: acc.pending + s.pending, failed: acc.failed + s.failed }),
      { signal, uploaded: 0, pending: 0, failed: 0 }));
  const kind: MyStatusKind = raw.failed > 0 ? 'needs_attention'
    : raw.pending > 0 ? 'uploading'
      : (feature.total_count > 0 || raw.uploaded > 0) ? 'received' : 'no_data';
  const a = feature.updated_at; const b = raw.updated_at;
  const lastReceivedAt = a && b ? (a > b ? a : b) : (a ?? b);
  return {
    kind, featureWindows: feature.total_count,
    raw: { registered: raw.total, uploaded: raw.uploaded, pending: raw.pending, failed: raw.failed },
    signals, lastReceivedAt,
  };
}

export interface SessionCandidateInput {
  id: string; seq: number | null; scheduled_at: string | null; status: string;
  attendance: { entered_at: string | null } | null | undefined;
  classTitle: string;
}
const VISIBLE_STATUS = new Set(['in_progress', 'open', 'completed']);
/** 본인 참여 기록이 있고 시작됐거나 끝난 회차만, 최근순. */
export function pickCandidateSessions<T extends SessionCandidateInput>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => r.attendance != null && VISIBLE_STATUS.has(r.status))
    .sort((x, y) => (y.scheduled_at ?? '').localeCompare(x.scheduled_at ?? ''));
}
export const isLiveSession = (status: string): boolean => status === 'in_progress' || status === 'open';
