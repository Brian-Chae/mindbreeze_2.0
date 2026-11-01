// SDD-260 W1 — GET /features/summary 대조(contract.md §2).
// 서버는 min_index 이전·max_index 이후 누락을 알 수 없다 → "빈 배열 = 완료"로 판정하지 않고,
// 완료 = 로컬 sequence 집합 − 서버 보유 집합 = ∅. 서버 보유 = [min_index,max_index] − missing_ranges.
// truncated(missing_ranges 200개 초과)면 마지막 range 이후는 미확인이므로 전부 결측으로 보고 재전송 후 재조회로 수렴시킨다.
export interface FeatureSummaryStream {
  stream_id: string; count: number; min_index: number; max_index: number;
  contiguous_through: number; missing_ranges: Array<[number, number]>; truncated: boolean;
}
export interface FeatureSummary {
  session_id: string; participant_id: string; total_count: number; streams: FeatureSummaryStream[]; updated_at: string | null;
}
export interface SummaryDiff { missing: Record<string, string[]>; complete: boolean }

const isU64 = (v: string): boolean => /^\d+$/.test(v);

export function diffAgainstSummary(local: Record<string, string[]>, summary: FeatureSummary): SummaryDiff {
  const byStream = new Map(summary.streams.map((s) => [s.stream_id, s]));
  const missing: Record<string, string[]> = {};
  for (const [streamId, seqs] of Object.entries(local)) {
    const s = byStream.get(streamId);
    const out: string[] = [];
    for (const q of seqs) {
      if (!s || !isU64(q)) { out.push(q); continue; }
      const n = BigInt(q);
      if (n < BigInt(s.min_index) || n > BigInt(s.max_index)) { out.push(q); continue; }
      let held = true;
      for (const [lo, hi] of s.missing_ranges) if (n >= BigInt(lo) && n <= BigInt(hi)) { held = false; break; }
      if (held && s.truncated) {
        const lastHi = s.missing_ranges.length > 0 ? BigInt(s.missing_ranges[s.missing_ranges.length - 1]![1]) : -1n;
        if (n > lastHi) held = false; // 마지막 range 이후는 서버가 다 알려주지 못했다
      }
      if (!held) out.push(q);
    }
    if (out.length > 0) missing[streamId] = out;
  }
  return { missing, complete: Object.keys(missing).length === 0 };
}
