/**
 * SDD-244 T08 — 영속 큐 업로더. presign → 서명 헤더 그대로 PUT → 항목별 검증 ACK → receipt 영속 → GC.
 * HTTP 200이어도 항목별 upload_status/ID/alias/hash/size가 모두 맞아야 성공이다.
 */
import { ApiError } from '../api/client';
import type { ArtifactMeta, BiosignalApi, RawMeta } from '../api/biosignal';
import type { BiosignalQueue, QueuedObject } from './durable-queue';

export type PutObject = (url: string, payload: ArrayBuffer, headers: Record<string, string>) => Promise<void>;
export const UPLOAD_CONCURRENCY = 2;
export interface UploadSummary { acked: number; failed: number; blocked: number }

class Stale extends Error {}

async function uploadOne(queue: BiosignalQueue, api: BiosignalApi, object: QueuedObject, put: PutObject, active: () => boolean): Promise<void> {
  const raw = object.kind === 'raw';
  const meta = object.meta;
  const expectChecksum = meta.checksum, expectSize = meta.size_bytes;
  const guard = () => { if (!active()) throw new Stale(); };
  guard();
  const ticket = await api.presign(object.sessionId, object.participantId, object.kind, meta as RawMeta | ArtifactMeta);
  guard();
  const ticketAlias = raw ? ticket?.chunk_alias : ticket?.artifact_alias;
  const serverId = raw ? ticket?.chunk_id : ticket?.artifact_id;
  if (!ticket || !serverId || ticketAlias !== object.alias || ticket.checksum !== expectChecksum || ticket.size_bytes !== expectSize) throw new Error('presign 응답이 요청 객체와 일치하지 않습니다');
  // upload_url=null이면 이미 검증된 객체: PUT 없이 ACK만 재요청한다.
  if (ticket.upload_url) { await put(ticket.upload_url, object.payload, ticket.upload_headers ?? {}); guard(); }
  const ack = await api.ack(object.sessionId, object.participantId, object.kind, serverId, expectChecksum, expectSize);
  guard();
  const ackAlias = ack && (raw ? ack.chunk_alias : ack.artifact_alias);
  if (!ack || ack.upload_status !== 'uploaded' || !ack.verified_at_us || ackAlias !== object.alias || ack.checksum !== expectChecksum || ack.size_bytes !== expectSize) {
    throw new Error(ack?.failure_reason ?? '서버가 해당 객체 저장을 확인하지 않았습니다');
  }
  await queue.complete(object, { kind: object.kind, alias: object.alias, sha256: expectChecksum, serverId, size_bytes: expectSize, verified_at_us: ack.verified_at_us });
}

export async function uploadBiosignalQueue(queue: BiosignalQueue, api: BiosignalApi, put: PutObject, active: () => boolean, now: () => number = Date.now): Promise<UploadSummary> {
  const summary: UploadSummary = { acked: 0, failed: 0, blocked: 0 };
  const todo = (await queue.objects()).filter(o => {
    if (o.state === 'dead_letter') { summary.blocked += 1; return false; }
    return o.retryAfter <= now();
  });
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length && active()) {
      const object = todo[cursor++];
      try { await uploadOne(queue, api, object, put, active); summary.acked += 1; } catch (error) {
        if (error instanceof Stale) return; // 계정/탭 변경: 사본 보존, 시도 횟수도 올리지 않는다.
        summary.failed += 1;
        // 403/409(권한·동의 철회·충돌)는 재시도해도 같으므로 즉시 보관 상태로 전환한다. 삭제는 하지 않는다.
        const permanent = error instanceof ApiError && [400, 403, 404, 409, 413, 422].includes(error.status);
        try { await queue.fail(object.id, error instanceof Error ? error.message : 'upload_failed', permanent); } catch { /* lease 상실: 사본은 그대로 */ }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, todo.length) }, worker));
  return summary;
}

/** gap/close intent 멱등 배치(≤100). recorded·duplicate만 sent 처리하고 conflict는 남겨 둔다. */
export async function sendBiosignalEvents(queue: BiosignalQueue, api: BiosignalApi, active: () => boolean) {
  const pending = (await queue.pendingEvents()).slice(0, 100);
  if (!pending.length || !active()) return null;
  const result = await api.events(queue.sessionId, queue.participantId, pending.map(p => p.event));
  if (!active()) return result;
  const ok = new Set(result.events.filter(e => e.status !== 'conflict').map(e => e.event_id));
  await queue.markEventsSent(pending.filter(p => ok.has(p.event.event_type === 'gap' ? p.event.event_id : p.event.intent_id)).map(p => ({ id: p.id, store: p.store })));
  return result;
}
