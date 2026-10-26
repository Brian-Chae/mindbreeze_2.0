// SDD-246 T06c — live:metric 송신 대기열(웹). 서버 응답 규칙(T05b progress 「T06/T07/T08 이 맞춰야 할 변경」 3항):
//  - 창별 accepted·duplicate(durable:true) 만 제거한다.
//  - 창별 rejected 는 재전송해도 같은 결과라 재시도 금지(제거하고 rejected 목록에 남긴다).
//    stream 단위 거절(stale_owner_generation 등)은 그 stream 의 대기 창 전체를 버리고 onFenced 로 알린다.
//  - 창별 retryable / 배치 오류 retryable(not_ready·*_ingest_unavailable·timeout 등)만 남겨 retry_after_ms 뒤 재전송.
//  - 배치 오류 비재시도(invalid_message 등)는 그 배치를 버린다(같은 내용은 다시 보내도 거절).
// live 는 최신값 표시용이다. 대기 상한을 넘으면 가장 오래된 창부터 버린다 — 빠진 창의 정본은 archive(T09) 경로가 보존한다.
import type { MetricSendOutcome } from '../session-live/live-client';
import type { MetricEnvelope } from './envelope';

export const MAX_BATCH_WINDOWS = 60;
/** 1Hz 기준 5분 */
export const DEFAULT_MAX_PENDING = 300;
const DEFAULT_RETRY_MS = 1_000;

/** 같은 stream 의 이후 창도 똑같이 거절되는 코드 — 재시도·추가 전송이 무의미하다 */
export const STREAM_FATAL_CODES: ReadonlySet<string> = new Set([
  'stale_owner_generation', 'stream_not_found', 'participant_mismatch', 'session_mismatch', 'window_after_cutoff',
]);

export interface MetricOutboxOptions {
  send: (windows: MetricEnvelope[]) => Promise<MetricSendOutcome>;
  maxPending?: number;
  maxBatch?: number;
  onFenced?: (code: string, streamId: string) => void;
  now?: () => number;
}

const keyOf = (e: Pick<MetricEnvelope, 'stream_id' | 'sequence'>): string => `${e.stream_id}:${e.sequence}`;

export class MetricOutbox {
  private readonly o: MetricOutboxOptions;
  private pending: MetricEnvelope[] = [];
  private rejectedList: Array<{ key: string; code: string }> = [];
  private dropped = 0;
  private inflight: Promise<void> | null = null;
  private notBeforeMs = 0;

  constructor(o: MetricOutboxOptions) {
    this.o = o;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  enqueue(env: MetricEnvelope): void {
    const k = keyOf(env);
    if (this.pending.some((p) => keyOf(p) === k)) return; // 같은 창 중복 enqueue 방지
    const max = this.o.maxPending ?? DEFAULT_MAX_PENDING;
    const next = [...this.pending, env];
    const over = next.length - max;
    if (over > 0) this.dropped += over;
    this.pending = over > 0 ? next.slice(over) : next;
  }

  pendingKeys(): string[] {
    return this.pending.map(keyOf);
  }

  rejected(): Array<{ key: string; code: string }> {
    return [...this.rejectedList];
  }

  droppedCount(): number {
    return this.dropped;
  }

  /** stream 이 끝났을 때(close·fencing) 그 stream 의 대기 창을 버린다 */
  discardStream(streamId: string): void {
    this.pending = this.pending.filter((p) => p.stream_id !== streamId);
  }

  /** 한 배치를 보낸다. 이미 보내는 중이거나 재시도 대기 중이면 아무 것도 하지 않는다. */
  flush(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (this.pending.length === 0 || this.now() < this.notBeforeMs) return Promise.resolve();
    const batch = this.pending.slice(0, this.o.maxBatch ?? MAX_BATCH_WINDOWS);
    this.inflight = this.o.send(batch)
      .then((out) => this.settle(batch, out))
      .catch(() => { this.notBeforeMs = this.now() + DEFAULT_RETRY_MS; })
      .finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private settle(batch: MetricEnvelope[], out: MetricSendOutcome): void {
    if (out.kind === 'not_sent') return; // 연결 복구 후 그대로 다시 보낸다
    const sentKeys = new Set(batch.map(keyOf));
    if (out.kind === 'error') {
      if (out.retryable) {
        this.notBeforeMs = this.now() + (out.retryAfterMs ?? DEFAULT_RETRY_MS);
        return;
      }
      this.rejectedList = [...this.rejectedList, ...batch.map((e) => ({ key: keyOf(e), code: out.code }))];
      this.pending = this.pending.filter((p) => !sentKeys.has(keyOf(p)));
      return;
    }
    const remove = new Set<string>();
    const fencedStreams = new Map<string, string>();
    let retry = false;
    for (const a of out.acks) {
      const k = keyOf(a);
      if (!sentKeys.has(k)) continue; // 보내지 않은 창의 ACK 는 무시
      if (a.status === 'accepted' || a.status === 'duplicate') {
        if (a.durable) remove.add(k); else retry = true;
      } else if (a.status === 'rejected') {
        const code = a.code ?? 'rejected';
        remove.add(k);
        this.rejectedList = [...this.rejectedList, { key: k, code }];
        if (STREAM_FATAL_CODES.has(code)) fencedStreams.set(a.stream_id, code);
      } else {
        retry = true;
      }
    }
    this.pending = this.pending.filter((p) => !remove.has(keyOf(p)) && !fencedStreams.has(p.stream_id));
    if (retry) this.notBeforeMs = this.now() + DEFAULT_RETRY_MS;
    for (const [streamId, code] of fencedStreams) this.o.onFenced?.(code, streamId);
  }
}
