// SDD-275 — 웹 경로의 "폰이 만든 원시 청크 총량"(신호별). 네이티브 archive.counts 와 같은 정의(contract §1):
// pending + uploading + verified + quarantined. 웹 BiosignalQueue 에서는
//  - 아직 올라가지 않은 청크(sealed_chunks: pending·dead_letter·time_review) + 올라가 검증된 청크(ack_receipts) 의 합이다.
//  - 분할 복구된 원본(superseded)은 자식 alias 가 대체하므로 세지 않는다.
// SDD-276 — 서버는 eeg_raw_chunks 의 행 수(신호별)를 센다. 그래서
//  - 같은 청크는 sealed 와 receipt 에 동시에 보여도(읽는 사이 업로드가 끝남) 한 번만 센다(id 합집합).
//  - 웹 측정이 v2 와 함께 올리는 레거시(v1 1초) 뇌파 청크도 같은 테이블의 eeg 행이므로 eeg 에 더한다(legacyEeg).
import { BiosignalQueue } from './durable-queue';
import type { RawTotals } from './expected-reporter';

type Sig = 'eeg' | 'ppg' | 'acc';
const sigOf = (meta: unknown): Sig | null => {
  const s = (meta as { header?: { signal_type?: string } } | undefined)?.header?.signal_type;
  return s === 'eeg' || s === 'ppg' || s === 'acc' ? s : null;
};

export async function computeWebRawTotals(queue: BiosignalQueue, legacyEeg = 0): Promise<RawTotals> {
  const totals: RawTotals = { eeg: Math.max(0, Math.floor(legacyEeg) || 0), ppg: 0, acc: 0 };
  const counted = new Set<string>();
  // 순서가 중요하다: sealed 를 먼저 읽고 receipt 를 나중에 읽으면 업로드가 끝난 청크는 어느 쪽에도 빠지지 않는다(중복은 id 로 제거).
  for (const m of await queue.objectsMeta()) {
    if (m.kind !== 'raw' || m.state === 'superseded') continue;
    const sig = sigOf(m.meta);
    if (sig && !counted.has(m.id)) { counted.add(m.id); totals[sig] += 1; }
  }
  for (const r of await queue.receipts()) {
    if (r.kind !== 'raw') continue;
    const sig = sigOf(r.meta);
    if (sig && !counted.has(r.id)) { counted.add(r.id); totals[sig] += 1; }
  }
  return totals;
}
