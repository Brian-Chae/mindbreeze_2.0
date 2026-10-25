/**
 * SDD-244 T08 — 영속 큐 업로더. presign → 서명 헤더 그대로 PUT → 항목별 검증 ACK → receipt 영속 → GC.
 * HTTP 200이어도 항목별 upload_status/ID/alias/hash/size가 모두 맞아야 성공이다.
 */
import { ApiError } from '../api/client';
import type { ArtifactMeta, BiosignalApi, RawMeta } from '../api/biosignal';
import type { BiosignalQueue, QueuedObject } from './durable-queue';
import { sha256 } from './capture-session';
import { classifyArchiveError, type ArchiveStage } from './archive-errors';

export type PutObject = (url: string, payload: ArrayBuffer, headers: Record<string, string>) => Promise<void>;
export const UPLOAD_CONCURRENCY = 4;
/** 한 번에 payload 를 읽어 보낼 최대 건수. 적체돼도 메모리에는 이 만큼만 올린다. */
export const UPLOAD_BATCH = 24;
export interface UploadSummary { acked: number; failed: number; blocked: number; halted?: string; timeReview?: number; deadlinePassed?: number }
/** SDD-246 T09 옵션. archiveV3=false(기본)는 v1/v2 동작 그대로다. */
export interface UploadOptions {
  archiveV3?: boolean;
  /** 서버가 등록한 capture stream. 있으면 presign 에 실려 종료 cutoff 판정을 받는다. */
  captureStreamId?: string | null;
  /** 큐 time_range(상대 µs)를 단조시계로 옮기는 기준(= 세션 originMonotonicUs). */
  originMonotonicUs?: string | null;
  /** 서버 close deadline(epoch ms). 지나면 네트워크 시도 없이 사유와 함께 보존한다. */
  closeDeadlineMs?: number | null;
}
const REPRESIGN_MAX = 2;
/** ACK 가 failed 로 돌려준 사유 중 같은 바이트로는 영영 통과 못 하는 것(내용 불일치) → 격리. 그 외(저장소 미확인 등)는 backoff. */
const PERMANENT_ACK_REASONS = new Set(['ack_metadata_mismatch', 'content_schema_invalid', 'row_count_mismatch', 'uncompressed_hash_mismatch']);

class Stale extends Error {}

/** 이전 빌드가 만든 time_range 역전(from > to)을 presign 전에 바로잡는다. 서버 TimeRange.ordered 위반은 422 영구 실패라 보관본이 서버에 못 올라간다. checksum 은 payload 기준이라 영향 없다. */
export function normalizeArtifactMeta<T extends RawMeta | ArtifactMeta>(meta: T): T {
  const range = (meta as ArtifactMeta).time_range;
  if (!range) return meta;
  try {
    if (BigInt(range.from_us) <= BigInt(range.to_us)) return meta;
    return { ...meta, time_range: { from_us: range.to_us, to_us: range.from_us } };
  } catch { return meta; }
}

async function uploadOne(queue: BiosignalQueue, api: BiosignalApi, object: QueuedObject, put: PutObject, active: () => boolean): Promise<void> {
  const raw = object.kind === 'raw';
  const meta = normalizeArtifactMeta(object.meta);
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

class StageError extends Error { constructor(readonly stage: ArchiveStage, readonly cause: unknown) { super(cause instanceof Error ? cause.message : String(cause)); } }
class AckRejected extends Error { constructor(readonly reason: string) { super(reason); } }

function withMonotonicRange<T extends RawMeta | ArtifactMeta>(meta: T, origin: string | null | undefined): T {
  const range = (meta as ArtifactMeta).time_range;
  if (!range || origin == null) return meta;
  try {
    return { ...meta, monotonic_range: { from_us: (BigInt(range.from_us) + BigInt(origin)).toString(), to_us: (BigInt(range.to_us) + BigInt(origin)).toString() } };
  } catch { return meta; }
}

/** v3: 단계(presign|put|verify)를 추적하고, PUT 서명 만료 403 은 새 presign 으로 복구한다. */
async function uploadOneStaged(queue: BiosignalQueue, api: BiosignalApi, object: QueuedObject, put: PutObject, active: () => boolean, opts: UploadOptions): Promise<void> {
  const raw = object.kind === 'raw';
  const meta = withMonotonicRange(normalizeArtifactMeta(object.meta), opts.captureStreamId ? opts.originMonotonicUs : null);
  const expectChecksum = meta.checksum, expectSize = meta.size_bytes;
  const guard = () => { if (!active()) throw new Stale(); };
  guard();
  // 로컬 봉인 검증: 디스크/IDB 손상 바이트를 서버에 올려 ACK 불일치로 낭비하지 않는다. 같은 alias 에 다른 바이트 금지 규칙의 클라이언트 쪽 방어선.
  if (await sha256(object.payload) !== expectChecksum || object.payload.byteLength !== expectSize) throw new StageError('presign', new AckRejected('local_seal_mismatch'));
  for (let represign = 0; ; represign++) {
    let ticket;
    try { ticket = await api.presign(object.sessionId, object.participantId, object.kind, meta as RawMeta | ArtifactMeta, null, opts.captureStreamId ?? null); } catch (error) { throw new StageError('presign', error); }
    guard();
    const ticketAlias = raw ? ticket?.chunk_alias : ticket?.artifact_alias;
    const serverId = raw ? ticket?.chunk_id : ticket?.artifact_id;
    if (!ticket || !serverId || ticketAlias !== object.alias || ticket.checksum !== expectChecksum || ticket.size_bytes !== expectSize) throw new StageError('presign', new Error('presign 응답이 요청 객체와 일치하지 않습니다'));
    if (ticket.upload_url) {
      try { await put(ticket.upload_url, object.payload, ticket.upload_headers ?? {}); } catch (error) {
        guard();
        const decision = classifyArchiveError('put', error);
        if (decision.action === 'represign' && represign < REPRESIGN_MAX) continue; // 서명 만료: 새 URL 로 다시
        throw new StageError('put', error);
      }
      guard();
    }
    let ack;
    try { ack = await api.ack(object.sessionId, object.participantId, object.kind, serverId, expectChecksum, expectSize); } catch (error) { throw new StageError('verify', error); }
    guard();
    const ackAlias = ack && (raw ? ack.chunk_alias : ack.artifact_alias);
    if (!ack || ack.upload_status !== 'uploaded' || !ack.verified_at_us || ackAlias !== object.alias || ack.checksum !== expectChecksum || ack.size_bytes !== expectSize) {
      const reason = ack?.failure_reason ?? 'ack_unconfirmed';
      // 저장소가 객체를 못 찾았다면(PUT 이 반영되지 않음) 새 presign+PUT 으로 복구한다.
      if (reason === 'object_verification_failed' && represign < REPRESIGN_MAX) continue;
      throw new StageError('verify', new AckRejected(reason));
    }
    await queue.complete(object, { kind: object.kind, alias: object.alias, sha256: expectChecksum, serverId, size_bytes: expectSize, verified_at_us: ack.verified_at_us });
    return;
  }
}

export async function uploadBiosignalQueue(queue: BiosignalQueue, api: BiosignalApi, put: PutObject, active: () => boolean, now: () => number = Date.now, opts: UploadOptions = {}): Promise<UploadSummary> {
  const summary: UploadSummary = { acked: 0, failed: 0, blocked: 0 };
  const { batch: todo, blocked } = await queue.dueBatch(UPLOAD_BATCH, now());
  summary.blocked = blocked;
  let cursor = 0;
  let halted = false;
  const worker = async () => {
    while (cursor < todo.length && active() && !halted) {
      const object = todo[cursor++];
      if (opts.archiveV3) {
        if (opts.closeDeadlineMs != null && now() > opts.closeDeadlineMs) {
          // 24h 유예 초과: 자동 삭제 없이 사유를 표시한다(payload 보존).
          summary.deadlinePassed = (summary.deadlinePassed ?? 0) + 1;
          try { await queue.failStaged(object.id, { reason: 'close_deadline_passed', stage: 'local', mode: 'dead_letter' }); } catch { /* lease 상실 */ }
          continue;
        }
        try { await uploadOneStaged(queue, api, object, put, active, opts); summary.acked += 1; } catch (error) {
          if (error instanceof Stale) return;
          summary.failed += 1;
          const stage: ArchiveStage = error instanceof StageError ? error.stage : 'presign';
          const cause = error instanceof StageError ? error.cause : error;
          let record: Parameters<BiosignalQueue['failStaged']>[1];
          if (cause instanceof AckRejected) {
            record = cause.reason === 'local_seal_mismatch' || PERMANENT_ACK_REASONS.has(cause.reason)
              ? { reason: cause.reason, stage: cause.reason === 'local_seal_mismatch' ? 'local' : stage, mode: 'dead_letter' }
              : { reason: cause.reason, stage, mode: 'backoff' };
          } else {
            const decision = classifyArchiveError(stage, cause);
            if (decision.action === 'halt') { halted = true; summary.halted = decision.code; }
            if (decision.action === 'time_review') summary.timeReview = (summary.timeReview ?? 0) + 1;
            const mode = decision.action === 'backoff' || decision.action === 'represign' ? 'backoff' : decision.action === 'time_review' ? 'time_review' : 'dead_letter';
            record = { reason: decision.action === 'represign' ? decision.code : decision.code === 'forbidden' || decision.code.startsWith('http_') ? (cause instanceof Error ? cause.message : decision.code) : decision.code, stage, mode, retryAfterMs: decision.retryAfterMs ?? undefined, splitCandidate: decision.splitCandidate || undefined };
          }
          try { await queue.failStaged(object.id, record); } catch { /* lease 상실: 사본은 그대로 */ }
        }
        continue;
      }
      try { await uploadOne(queue, api, object, put, active); summary.acked += 1; } catch (error) {
        if (error instanceof Stale) return; // 계정/탭 변경: 사본 보존, 시도 횟수도 올리지 않는다.
        summary.failed += 1;
        // 403/409(권한·동의 철회·충돌)는 재시도해도 같으므로 즉시 보관 상태로 전환한다. 삭제는 하지 않는다.
        // 409 는 '이미 저장'이 아니다: 같은 내용 재요청은 200(upload_url=null)로 오고, 409 는 같은 슬롯·alias 에 다른 내용이 있다는 뜻이라
        // 성공으로 간주하면 데이터가 유실된다. 영구 재시도하지 않고 보관(dead_letter)해 '전송 확인 필요'로 노출한다.
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
  const ok = new Set(result.events.filter(e => e.status === 'recorded' || e.status === 'duplicate').map(e => e.event_id));
  await queue.markEventsSent(pending.filter(p => ok.has(p.event.event_type === 'gap' ? p.event.event_id : p.event.intent_id)).map(p => ({ id: p.id, store: p.store })));
  return result;
}
