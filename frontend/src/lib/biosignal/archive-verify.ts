/**
 * SDD-246 T09 — archive 완결성 판정(seal/manifest). 서버 close_state 만으로 완료라 하지 않고,
 * 로컬 큐·receipt·분할 복구·서버 missing 목록을 모두 대조한다. 하나라도 남으면 complete=false + 사유.
 */
import type { EventsResult } from '../api/biosignal';
import type { BiosignalQueue } from './durable-queue';

export type UnresolvedReason = 'pending' | 'dead_letter' | 'time_review' | 'hash_mismatch' | 'split_incomplete' | 'server_missing' | string;
export interface ArchiveVerification {
  complete: boolean;
  unresolved: { alias: string; reason: UnresolvedReason }[];
  /** 자식이 전부 receipt 로 확정되어 복구로 인정된 분할 부모 alias */
  recoveredParents: string[];
  closeState: EventsResult['close_state'] | null;
}

export async function verifyArchiveCompleteness(queue: BiosignalQueue, server: Pick<EventsResult, 'close_state' | 'missing_artifacts'> | null): Promise<ArchiveVerification> {
  const unresolved: ArchiveVerification['unresolved'] = [];
  const recoveredParents: string[] = [];
  const objects = await queue.objectsMeta();
  const receipts = await queue.receipts();
  const receiptByAlias = new Map(receipts.map(r => [`${r.kind}|${r.alias}`, r]));
  const present = new Set(objects.map(o => `${o.kind}|${o.alias}`));

  for (const r of receipts) {
    if (r.meta && r.sha256 !== r.meta.checksum) unresolved.push({ alias: r.alias, reason: 'hash_mismatch' });
  }
  for (const o of objects) {
    if (o.state === 'pending') unresolved.push({ alias: o.alias, reason: 'pending' });
    else if (o.state === 'dead_letter') unresolved.push({ alias: o.alias, reason: o.lastError ? `dead_letter:${o.lastError}` : 'dead_letter' });
    else if (o.state === 'time_review') unresolved.push({ alias: o.alias, reason: 'time_review' });
    else if (o.state === 'superseded') {
      const kids = o.splitInto ?? [];
      const missingKid = kids.some(alias => !receiptByAlias.has(`${o.kind}|${alias}`) && !present.has(`${o.kind}|${alias}`));
      if (!kids.length || missingKid) unresolved.push({ alias: o.alias, reason: 'split_incomplete' });
      else if (kids.every(alias => receiptByAlias.has(`${o.kind}|${alias}`))) recoveredParents.push(o.alias);
      // 자식이 아직 큐에 있으면 그 항목이 자기 사유(pending 등)로 이미 보고된다.
    }
  }
  const recovered = new Set(recoveredParents);
  for (const m of server?.missing_artifacts ?? []) {
    if (!recovered.has(m.alias)) unresolved.push({ alias: m.alias, reason: 'server_missing' });
  }
  const closeState = server?.close_state ?? null;
  if (closeState !== 'complete' && unresolved.length === 0) unresolved.push({ alias: 'close_intent', reason: `close_state:${closeState ?? 'none'}` });
  return { complete: unresolved.length === 0 && closeState === 'complete', unresolved, recoveredParents, closeState };
}
