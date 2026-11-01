// SDD-264: 총량 대비 수집률 수식(순수 함수). 와이어 필드명에 의존하지 않는다 — 어댑터가 숫자만 넘긴다.
// 규칙: 수신이 기대를 넘어도 진행률은 기대까지만 센다(초과 수신은 100% 초과가 아니라 '모두 수신').
//       기대량 미보고 참여자는 분모에서 빼지 않고 별도 카운트한다. 수집 제외(기대 0)는 분모에서 제외한다.
export interface Quantity { expected: number | null; received: number }

export type ParticipantProgressKind = 'all_received' | 'in_progress' | 'expected_unknown' | 'excluded';

export interface ParticipantQuantities {
  excluded: boolean;
  feature: Quantity;
  raw: { eeg: Quantity; ppg: Quantity; acc: Quantity };
}

export interface Ratio { received: number; expected: number }
export interface ProgressSummary {
  participantsTotal: number;
  participantsAllReceived: number;
  expectedUnknown: number;
  excluded: number;
  feature: Ratio;
  raw: Ratio;
  rawBySignal: { eeg: Ratio; ppg: Ratio; acc: Ratio };
  /** 0~1. 분모가 0이면 null(0%로 보이지 않게 중립 표시) */
  overall: number | null;
}

const clampRecv = (q: Quantity): number => Math.max(0, Math.min(q.received, q.expected ?? 0));
const known = (q: Quantity): q is Quantity & { expected: number } => q.expected !== null && q.expected >= 0;

/** 한 참여자의 상태. 기대 미보고(하나라도 null) → expected_unknown, 전부 수신 → all_received. */
export function participantProgressKind(p: ParticipantQuantities): ParticipantProgressKind {
  if (p.excluded) return 'excluded';
  const all = [p.feature, p.raw.eeg, p.raw.ppg, p.raw.acc];
  if (all.some((q) => !known(q))) return 'expected_unknown';
  return all.every((q) => q.received >= (q.expected as number)) ? 'all_received' : 'in_progress';
}

const addRatio = (r: Ratio, q: Quantity): Ratio => (known(q) ? { received: r.received + clampRecv(q), expected: r.expected + q.expected } : r);

export function summarizeProgress(rows: readonly ParticipantQuantities[]): ProgressSummary {
  let feature: Ratio = { received: 0, expected: 0 };
  const sig = { eeg: { received: 0, expected: 0 }, ppg: { received: 0, expected: 0 }, acc: { received: 0, expected: 0 } };
  let allReceived = 0; let unknown = 0; let excluded = 0;
  for (const p of rows) {
    const kind = participantProgressKind(p);
    if (kind === 'excluded') { excluded += 1; continue; }
    if (kind === 'all_received') allReceived += 1;
    if (kind === 'expected_unknown') unknown += 1;
    feature = addRatio(feature, p.feature);
    sig.eeg = addRatio(sig.eeg, p.raw.eeg); sig.ppg = addRatio(sig.ppg, p.raw.ppg); sig.acc = addRatio(sig.acc, p.raw.acc);
  }
  const raw: Ratio = { received: sig.eeg.received + sig.ppg.received + sig.acc.received, expected: sig.eeg.expected + sig.ppg.expected + sig.acc.expected };
  const denom = feature.expected + raw.expected;
  return {
    participantsTotal: rows.length - excluded, participantsAllReceived: allReceived, expectedUnknown: unknown, excluded,
    feature, raw, rawBySignal: sig, overall: denom > 0 ? (feature.received + raw.received) / denom : null,
  };
}

/** 진행 막대 폭(%). 정수로 내림해 99.9%가 100%로 보이지 않게 한다. */
export const barPercent = (r: number | null): number | null => (r === null ? null : Math.floor(Math.min(Math.max(r, 0), 1) * 100));
