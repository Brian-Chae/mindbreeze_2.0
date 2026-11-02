// SDD-275 — 웹 경로의 "폰이 만든 원시 청크 총량"(신호별). 네이티브 archive.counts 와 같은 정의(contract §1):
// pending + uploading + verified + quarantined. 웹 BiosignalQueue 에서는
//  - 아직 올라가지 않은 청크(sealed_chunks: pending·dead_letter·time_review) + 올라가 검증된 청크(ack_receipts) 의 합이다.
//  - 분할 복구된 원본(superseded)은 자식 alias 가 대체하므로 세지 않는다.
import { BiosignalQueue } from './durable-queue';
import type { RawTotals } from './expected-reporter';

export async function computeWebRawTotals(queue: BiosignalQueue): Promise<RawTotals> {
  const totals: RawTotals = { eeg: 0, ppg: 0, acc: 0 };
  for (const m of await queue.objectsMeta()) {
    if (m.kind !== 'raw' || m.state === 'superseded') continue;
    const sig = (m.meta as { header?: { signal_type?: string } }).header?.signal_type;
    if (sig === 'eeg' || sig === 'ppg' || sig === 'acc') totals[sig] += 1;
  }
  for (const r of await queue.receipts()) {
    if (r.kind !== 'raw') continue;
    const sig = (r.meta as { header?: { signal_type?: string } } | undefined)?.header?.signal_type;
    if (sig === 'eeg' || sig === 'ppg' || sig === 'acc') totals[sig] += 1;
  }
  return totals;
}
