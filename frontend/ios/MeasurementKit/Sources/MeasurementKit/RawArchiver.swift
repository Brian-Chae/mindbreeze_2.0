import Foundation

/// SDD-315: raw.journal → raw-v2(MBRAW002) 청크 → 업로드 큐. **수업 중 증분**으로 돌고, 봉인 때 남은 구간만 마저 처리한다.
///
/// - 청커(`RawChunker`)를 센서별로 하나씩 **끝까지 들고** 있어, 구간을 나눠 먹여도 청크 경계·alias·바이트가 한 번에 변환한 것과 같다.
/// - 커서는 raw.journal 의 완결 레코드 끝 바이트 오프셋. 찢긴 꼬리는 다음 호출에서 이어 읽는다.
/// - 메모리 상태(청커·커서)가 사라져도(앱 강제 종료) 새 인스턴스가 커서 0 에서 같은 변환을 재생하면 같은 alias·같은 bytes 라
///   `ArchiveQueue.enqueue` 가 멱등으로 무시한다(결정적 alias, 중복·누락 없음).
/// - Android `RawArchiver.kt` 와 같은 역할. 수신 경로(BLE 콜백·journal fsync)는 건드리지 않는다.
public final class RawArchiver {
    private let dir: URL, sessionId: String, streamId: String, queue: ArchiveQueue
    private let reconnectCount: () -> Int64
    private let lock = NSLock()
    private var cursor: UInt64 = 0
    private var origin: Int64?
    private var chunkers: [BandSensor: RawChunker] = [:]
    private let gapStore: GapEventStore, linkLog: LinkDropLog

    public init(dir: URL, sessionId: String, streamId: String, queue: ArchiveQueue, reconnectCount: @escaping () -> Int64) {
        self.dir = dir; self.sessionId = sessionId; self.streamId = streamId; self.queue = queue; self.reconnectCount = reconnectCount
        gapStore = GapEventStore(file: dir.appendingPathComponent(GapEventStore.fileName), sessionId: sessionId)
        linkLog = LinkDropLog(file: dir.appendingPathComponent(LinkDropLog.fileName))
    }

    /// 지금까지 읽은 raw.journal 바이트 오프셋(시험·진단용).
    public var readOffset: UInt64 { lock.lock(); defer { lock.unlock() }; return cursor }

    /// 커서 이후의 새 패킷을 청커에 먹인다. 청크가 봉인되면 파일을 쓰고 큐에 넣는다.
    /// `final == true` 면 남은 샘플을 부분 청크로 봉인한다(수업 종료). 반환: 이번에 처리한 패킷 수.
    @discardableResult
    public func catchUp(final: Bool) -> Int {
        lock.lock(); defer { lock.unlock() }
        let r = MeasurementEngine.rawPackets(in: dir, fromOffset: cursor)
        for p in r.packets {
            if origin == nil { origin = Int64(p.wall) * 1000 + Int64(bitPattern: p.arrival &- p.anchor) }   // 첫 패킷 기준 — 일괄 변환과 동일
            let us = Int64(p.wall) * 1000 + Int64(bitPattern: p.arrival &- p.anchor)   // 코어 창과 같은 시간축
            chunker(p.sensor).onPacket(p.bytes, arrivalUs: us)
        }
        cursor = r.nextOffset
        if final { for c in chunkers.values { c.flush() } }
        return r.packets.count
    }

    private func chunker(_ s: BandSensor) -> RawChunker {
        if let c = chunkers[s] { return c }
        let sid = sessionId, store = gapStore, log = linkLog, count = reconnectCount
        let c = RawChunker(sensor: s, session: sid, originUs: origin ?? 0, onGap: { g in
            let reason = g.reason == "clock_reset" ? "clock_reset" : (log.kind(startUs: g.startUs, endUs: g.endUs) ?? "packet_gap")
            let est = reason == "process_terminated" ? "estimated" : "observed"
            // SDD-270: event_id 가 결정적이라 재생(복구)·증분에서도 중복되지 않는다.
            store.append(signal: g.signal, streamId: RawIds.streamId(session: sid, sensor: s), segmentId: g.segmentId, startUs: g.startUs, endUs: g.endUs, reason: reason, observedOrEstimated: est, reconnectCount: count())
        }) { [weak self] chunk in self?.put(chunk) }
        chunkers[s] = c; return c
    }

    private func put(_ chunk: RawChunk) {
        let out = dir.appendingPathComponent("archive")
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let file = chunk.alias + ".bin"
        let dst = out.appendingPathComponent(file)
        if !FileManager.default.fileExists(atPath: dst.path) { try? chunk.payload.write(to: dst, options: .atomic) }
        let h = chunk.meta["header"] as? [String: Any]
        let a = h?["anchor"] as? [String: Any]
        let from = (a?["monotonic_us"] as? String) ?? "0"
        var item = ArchiveItem(alias: chunk.alias, kind: .raw, file: file, sha256: Hashing.sha256Hex(chunk.payload), sizeBytes: chunk.payload.count,
                               captureStreamId: streamId, monotonicRange: (from, from))   // raw 는 header 가 창을 정의 — range 는 큐 표시용
        item.meta = chunk.meta
        try? queue.enqueue(item)
    }
}
