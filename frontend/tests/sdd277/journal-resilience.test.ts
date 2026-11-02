// SDD-277 A — iOS 에서 원시 기록(raw journal)이 IndexedDB 일시 오류 1번에 영구 중단되던 문제.
// 연결 공유(연결 수 고정)·연결 소실 재오픈·journal 재시도·파생 데이터 쓰기 실패 격리를 확인한다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { BiosignalQueue, type CaptureScope } from '../../src/lib/biosignal/durable-queue';
import { BiosignalCaptureSession, type SampleWindow } from '../../src/lib/biosignal/capture-session';
import { FeatureCollector } from '../../src/lib/biosignal/feature-collector';
import { parseRawPacket } from '../../src/lib/biosignal/raw-capture';
import { IdbOutboxStore } from '../../src/lib/measurement-web/metric-outbox';
import { IdbExpectedStore } from '../../src/lib/biosignal/expected-reporter';

const scope: CaptureScope = { accountId: 'entry:p', sessionId: 's277', participantId: 'p', deviceAlias: 'LINK-BAND' };
let uuid = 0;
const createId = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;
function eegPacket() {
  let n = 0;
  return () => {
    const bytes = new Uint8Array(4 + 50 * 7);
    new DataView(bytes.buffer).setUint32(0, Math.round(n * 0.2 * 32768), true);
    const mono = String(1_000_000 + n * 200_000); n += 1;
    return parseRawPacket('eeg', new DataView(bytes.buffer), String(1_780_000_000_000_000n + BigInt(mono)), mono);
  };
}
const domError = (name: string, message: string) => Object.assign(new Error(message), { name });
async function build(options: Partial<ConstructorParameters<typeof BiosignalCaptureSession>[0]> & { journalRetryDelaysMs?: number[] } = {}) {
  const queue = new BiosignalQueue(scope, 'tab-a');
  const session = new BiosignalCaptureSession({ queue, createId, ...options } as never);
  await session.start();
  return { queue, session };
}
/** 열린 IndexedDB 연결을 모두 기록한다(연결 소실 모사·열린 횟수 계수) */
function trackConnections() {
  const conns: IDBDatabase[] = [];
  const realOpen = indexedDB.open.bind(indexedDB);
  const spy = vi.spyOn(indexedDB, 'open').mockImplementation(((...args: Parameters<IDBFactory['open']>) => {
    const request = realOpen(...args);
    request.addEventListener('success', () => conns.push(request.result));
    return request;
  }) as never);
  return { conns, spy };
}
beforeEach(() => { uuid = 0; globalThis.indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

describe('SDD-277 A — 원시 기록(raw journal)은 일시적 저장 오류로 멈추지 않는다', () => {
  it('V1 journalPacket 이 InvalidStateError 를 2번 던져도 수집은 running 이고 모든 패킷이 영속된다', async () => {
    const { queue, session } = await build({ journalRetryDelaysMs: [0, 0, 0] });
    vi.spyOn(queue, 'journalPacket')
      .mockRejectedValueOnce(domError('InvalidStateError', 'The database connection is closing.'))
      .mockRejectedValueOnce(domError('InvalidStateError', 'The database connection is closing.'));
    const make = eegPacket();
    for (let i = 0; i < 5; i += 1) session.receive(make());
    await session.flush();
    expect(session.status).toBe('running');
    expect(await queue.allPackets()).toHaveLength(5);
  });

  it('V2 수집 중 모든 IndexedDB 연결이 닫혀도(iOS 연결 소실) 다음 패킷에서 다시 열어 영속한다', async () => {
    const { conns } = trackConnections();
    const { queue, session } = await build();
    const make = eegPacket();
    for (let i = 0; i < 3; i += 1) session.receive(make());
    await session.flush();
    for (const db of conns) db.close();
    for (let i = 0; i < 3; i += 1) session.receive(make());
    await session.flush();
    expect(session.status).toBe('running');
    expect(await queue.allPackets()).toHaveLength(6);
  });

  it('V3 계속 실패하면(재시도 소진) journal_failed 로 멈추되 오류 이름이 stopDetail 에 남는다 — 실제 유실 신호 유지', async () => {
    const { queue, session } = await build({ journalRetryDelaysMs: [0, 0, 0] });
    const write = vi.spyOn(queue, 'journalPacket').mockRejectedValue(domError('QuotaExceededError', 'quota exceeded'));
    const make = eegPacket();
    session.receive(make()); await session.flush();
    expect(write).toHaveBeenCalledTimes(4); // 최초 1 + 재시도 3
    expect(session.status).toBe('stopped');
    expect(session.stopReason).toBe('journal_failed');
    expect((session as unknown as { stopDetail: string | null }).stopDetail).toContain('QuotaExceededError');
  });

  it('V4 파생 데이터(feature draft) 쓰기 실패는 원시 기록을 멈추지 않는다', async () => {
    const { queue, session } = await build({ journalRetryDelaysMs: [0, 0, 0] });
    const make = eegPacket();
    for (let i = 0; i < 5; i += 1) session.receive(make());
    await session.flush();
    vi.spyOn(session, 'sealedOverlap').mockReturnValue([]);
    vi.spyOn(queue, 'saveDraft').mockRejectedValue(domError('UnknownError', 'disk'));
    const collector = new FeatureCollector({ queue, session });
    const win: SampleWindow = { signal: 'eeg', streamId: 'st', segmentId: 'sg', first: 0, end: 1, rate: 250, anchorUtcUs: '0', anchorRelUs: '0' };
    collector.emit('eeg', {}, { window: win, windowIndex: 0 });
    await new Promise(r => setTimeout(r, 30));
    expect(session.status).toBe('running');
    session.receive(make()); await session.flush();
    expect(await queue.allPackets()).toHaveLength(6);
  });

  it('V5 저장소 객체를 여러 번 만들어 써도 열리는 IndexedDB 연결은 1개다(60초 관측기가 연결을 쌓지 않는다)', async () => {
    const { spy } = trackConnections();
    for (let i = 0; i < 5; i += 1) {
      await new BiosignalQueue(scope, `t${i}`).counts();
      await new IdbOutboxStore().listScopes();
      await new IdbExpectedStore().list();
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
