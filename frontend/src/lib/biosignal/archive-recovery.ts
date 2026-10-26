/**
 * SDD-246 T09 — 과대 artifact(>1MiB)의 parent-alias 분할 복구.
 * 원본 바이트와 alias는 그대로 보존(superseded)하고, 같은 행들을 새 alias 자식으로 나눠 올린다.
 * 같은 alias에 다른 바이트를 덮지 않는다. 행을 해석할 수 없거나(원 raw/알고리즘 정보 없음) 분할로 줄지 않으면 미복구로 남긴다.
 */
import type { ArtifactKind, ArtifactMeta } from '../api/biosignal';
import type { BiosignalQueue, QueuedObject } from './durable-queue';
import { sha256 } from './capture-session';

export const MAX_OBJECT_BYTES = 1_048_576;
/** 자식 slot(sequence) 충돌을 피하는 대역: 부모 sequence * 1000 + 순번 + 오프셋. 서버 sequence 는 int32. */
const CHILD_SEQUENCE_BASE = 1_000_000;
const SPLITTABLE: readonly ArtifactKind[] = ['feature', 'raw_derived', 'indices'];
export const OVERSIZE_UNRECOVERABLE = 'oversize_unrecoverable';

export interface RecoveryResult { recovered: number; unrecoverable: number; children: number }

const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

async function pipe(bytes: ArrayBuffer, stream: CompressionStream | DecompressionStream): Promise<ArrayBuffer> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return out.arrayBuffer();
}
const gzip = (text: string) => pipe(toBuffer(new TextEncoder().encode(text)), new CompressionStream('gzip'));
const gunzip = (bytes: ArrayBuffer) => pipe(bytes, new DecompressionStream('gzip'));

function rowKey(kind: ArtifactKind): 'sequence' | 'second_index' | null {
  return kind === 'feature' ? 'sequence' : kind === 'indices' ? 'second_index' : null;
}
function featureRange(rows: Record<string, unknown>[]): { from_us: string; to_us: string } | null {
  let from: bigint | null = null, to: bigint | null = null;
  for (const r of rows) for (const w of (r.source_windows as { time_range?: { from_us: string; to_us: string } }[] | undefined) ?? []) {
    if (!w.time_range) continue;
    const a = BigInt(w.time_range.from_us), b = BigInt(w.time_range.to_us);
    if (from === null || a < from) from = a;
    if (to === null || b > to) to = b;
  }
  if (from === null || to === null) return null;
  return { from_us: (from <= to ? from : to).toString(), to_us: (from <= to ? to : from).toString() };
}

/** 압축 후 한도 이하가 될 때까지 행 구간을 이분한다(순서 보존). 단일 행도 넘으면 null. */
async function splitRows(rows: Record<string, unknown>[], encode: (r: Record<string, unknown>[]) => Promise<ArrayBuffer>): Promise<{ rows: Record<string, unknown>[]; bytes: ArrayBuffer }[] | null> {
  const bytes = await encode(rows);
  if (bytes.byteLength <= MAX_OBJECT_BYTES) return [{ rows, bytes }];
  if (rows.length <= 1) return null;
  const mid = Math.ceil(rows.length / 2);
  const left = await splitRows(rows.slice(0, mid), encode), right = await splitRows(rows.slice(mid), encode);
  return left && right ? [...left, ...right] : null;
}

async function recoverOne(queue: BiosignalQueue, parent: QueuedObject): Promise<number | null> {
  const meta = parent.meta as ArtifactMeta;
  if (parent.kind === 'raw' || !('artifact_kind' in parent.meta) || !SPLITTABLE.includes(meta.artifact_kind)) return null;
  const gz = meta.content_encoding !== 'identity';
  let rows: Record<string, unknown>[];
  try {
    const plain = gz ? await gunzip(parent.payload) : parent.payload;
    rows = new TextDecoder('utf-8', { fatal: true }).decode(plain).split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
    if (!rows.length || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return null;
  } catch { return null; }
  const textOf = (r: Record<string, unknown>[]) => r.map(x => JSON.stringify(x)).join('\n') + '\n';
  const parts = await splitRows(rows, r => (gz ? gzip(textOf(r)) : Promise.resolve(toBuffer(new TextEncoder().encode(textOf(r))))));
  if (!parts || parts.length < 2 || parts.length >= 1000) return null;
  const key = rowKey(meta.artifact_kind);
  const base = meta.artifact_alias.slice(0, 57);
  const aliases: string[] = [];
  const built: { child: ArtifactMeta; bytes: ArrayBuffer }[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const { rows: r, bytes } = parts[i];
    const alias = `${base}-P${String(i).padStart(3, '0')}`;
    aliases.push(alias);
    const first = key ? Number(r[0][key]) : null, last = key ? Number(r[r.length - 1][key]) : null;
    const range = meta.artifact_kind === 'feature' ? featureRange(r)
      : meta.artifact_kind === 'indices' && first !== null && last !== null ? { from_us: String(first * 1_000_000), to_us: String(last * 1_000_000) } : null;
    const child: ArtifactMeta = { ...meta, artifact_alias: alias, sequence: CHILD_SEQUENCE_BASE + meta.sequence * 1000 + i, first_sequence: first, last_sequence: last, row_count: r.length,
      feature_id_aliases: meta.artifact_kind === 'feature' ? r.map(x => String(x.feature_id_alias)) : undefined,
      checksum: await sha256(bytes), size_bytes: bytes.byteLength,
      uncompressed_sha256: gz ? await sha256(toBuffer(new TextEncoder().encode(textOf(r)))) : meta.uncompressed_sha256,
      time_range: range ?? meta.time_range ?? null };
    if (child.feature_id_aliases === undefined) delete child.feature_id_aliases;
    built.push({ child, bytes });
  }
  // 자식을 모두 영속한 뒤에만 부모를 superseded 로 바꾼다(중간 중단 시 부모가 pending 으로 남아 다음 라운드에 이어서 수행).
  for (const { child, bytes } of built) await queue.enqueueChild(child, bytes, { alias: meta.artifact_alias, sha256: meta.checksum });
  await queue.markSplit(parent.id, aliases);
  return parts.length;
}

/** 크기 초과로 올라갈 수 없는 산출물을 자식 alias 로 분할한다. 멱등(이미 분할/미복구 판정된 항목은 건너뜀). */
export async function recoverOversized(queue: BiosignalQueue): Promise<RecoveryResult> {
  const result: RecoveryResult = { recovered: 0, unrecoverable: 0, children: 0 };
  for (const m of await queue.objectsMeta()) {
    if (m.state === 'superseded' || m.parentAlias) continue;
    const oversized = m.meta.size_bytes > MAX_OBJECT_BYTES || m.splitCandidate === true;
    if (!oversized || (m.state === 'dead_letter' && m.lastError === OVERSIZE_UNRECOVERABLE)) continue;
    if (m.state === 'time_review') continue;
    const parent = (await queue.objects()).find(o => o.id === m.id);
    if (!parent) continue;
    const children = await recoverOne(queue, parent).catch(() => null);
    if (children === null) {
      await queue.failStaged(parent.id, { reason: OVERSIZE_UNRECOVERABLE, stage: 'local', mode: 'dead_letter', splitCandidate: true });
      result.unrecoverable += 1;
    } else { result.recovered += 1; result.children += children; }
  }
  return result;
}
