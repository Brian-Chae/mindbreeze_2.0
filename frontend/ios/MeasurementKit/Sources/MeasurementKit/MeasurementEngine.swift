import Foundation

public struct StreamContext {
    public let sessionId: String, participantId: String, streamId: String
    public let streamGeneration: UInt64
    public let clockAnchorId: String
    public let clockUncertaintyMs: Double
    public init(sessionId: String, participantId: String, streamId: String, streamGeneration: UInt64, clockAnchorId: String, clockUncertaintyMs: Double) {
        self.sessionId = sessionId; self.participantId = participantId; self.streamId = streamId
        self.streamGeneration = streamGeneration; self.clockAnchorId = clockAnchorId; self.clockUncertaintyMs = clockUncertaintyMs
    }
}

/// 시험 전용 크래시 주입 지점. 운영에서는 nil.
public enum CrashStage: CaseIterable { case afterRaw, afterCore, afterFeature, afterOutbox, duringCheckpoint }
public struct SimulatedCrash: Error {}
public typealias CrashHook = (CrashStage, Int) throws -> Void

public struct Gap: Equatable {
    public let kind: String, bounded: Bool, startSample: String, endMonotonicUs: UInt64?
}

/// 수집 파이프라인 한 줄기: BLE 패킷 → raw journal(fsync) → Rust 코어 → feature journal(fsync) → live outbox.
/// 순서 불변식: raw 가 항상 먼저 영속된다. 이후 단계는 raw 재생으로 결정적으로 복원 가능하므로(코어는 순수 상태기계),
/// 어느 지점에서 죽어도 재시작 시 (checkpoint 이후 raw 재생 + feature/outbox sequence 멱등) 으로 무중단 실행과 같은 feature 열이 된다.
/// 모든 호출은 한 직렬 큐에서 한다는 전제이나, 읽기 접근자를 위해 재진입 락을 둔다.
public final class MeasurementEngine {
    public enum EngineError: Error, Equatable { case storageFull, sealed, core(String) }

    public static let defaultDiskLimit: UInt64 = 512 * 1024 * 1024
    public struct Counters { public var packets: [String: UInt64] = ["eeg": 0, "ppg": 0, "acc": 0]; public var samples: [String: UInt64] = ["eeg": 0, "ppg": 0, "acc": 0]
        public var metricWindows: UInt64 = 0 }

    public let outbox: MetricOutbox
    public private(set) var counters = Counters()
    public private(set) var gaps: [Gap] = []
    public private(set) var blockedReason: String?
    public private(set) var recoveredFromSequence: UInt64 = 0
    public private(set) var recoveryUsedFullReplay = false
    public var lastCommittedRawSequence: UInt64 { lock.lock(); defer { lock.unlock() }; return raw.lastSequence }
    public var pendingLiveSequences: [UInt64] { outbox.pendingSequences }
    public var diskUsedBytes: UInt64 { lock.lock(); defer { lock.unlock() }; return raw.byteSize + feature.byteSize }
    public let diskLimitBytes: UInt64
    public var onFrame: (([String: Any]) -> Void)?

    private let dir: URL, configJSON: String, ctx: StreamContext
    private let versions: (profile: String, algorithm: String, model: String)
    private let checkpointEvery: Int
    private let hook: CrashHook?
    private var raw: AppendOnlyJournal, feature: AppendOnlyJournal
    private var core: CoreBridge?
    private var lastFeatureSeq: UInt64 = 0
    private var sinceCheckpoint = 0
    private var hookCounts: [CrashStage: Int] = [:]
    private var finalManifest: CoreFinal?
    private var sealedFlag = false
    private let lock = NSRecursiveLock()
    private var gapJournal: AppendOnlyJournal

    public init(dir: URL, configJSON: String, context: StreamContext, checkpointEveryPackets: Int = 400,
                diskLimitBytes: UInt64 = MeasurementEngine.defaultDiskLimit, journalSync: JournalSync = .full, crashHook: CrashHook? = nil) throws {
        self.dir = dir; self.configJSON = configJSON; self.ctx = context; self.checkpointEvery = checkpointEveryPackets
        self.diskLimitBytes = diskLimitBytes; self.hook = crashHook
        guard let cd = configJSON.data(using: .utf8), let c = try JSONSerialization.jsonObject(with: cd) as? [String: Any],
              let p = c["device_profile_version"] as? String, let a = c["algorithm_version"] as? String, let m = c["model_version"] as? String
        else { throw EngineError.core("config") }
        versions = (p, a, m)
        raw = try AppendOnlyJournal(url: dir.appendingPathComponent("raw.journal"), sync: journalSync)
        feature = try AppendOnlyJournal(url: dir.appendingPathComponent("feature.journal"), sync: journalSync)
        gapJournal = try AppendOnlyJournal(url: dir.appendingPathComponent("gap.journal"), sync: journalSync)
        outbox = try MetricOutbox(dir: dir, sync: journalSync)
        try recover()
    }

    /// 시험: 프로세스 종료 모사 — 메모리 상태를 버리고 파일 핸들만 닫는다(추가 쓰기 없음).
    public func abandon() { lock.lock(); raw.close(); feature.close(); gapJournal.close(); core?.destroy(); core = nil; lock.unlock() }

    private func fire(_ s: CrashStage) throws {
        guard let hook = hook else { return }
        hookCounts[s, default: 0] += 1
        try hook(s, hookCounts[s]!)
    }

    // MARK: 복구

    private struct RawRecord { let sensor: BandSensor; let arrival: UInt64; let wall: UInt64; let anchor: UInt64; let bytes: Data }
    private static func u64(_ d: Data, _ o: Int) -> UInt64 { (0..<8).reduce(0) { $0 | (UInt64(d[d.startIndex + o + $1]) << (8 * UInt64($1))) } }
    private static func encodeRaw(_ s: BandSensor, _ bytes: Data, _ arrival: UInt64, _ wall: UInt64, _ anchor: UInt64) -> Data {
        var d = Data([s.rawValue])
        for v in [arrival, wall, anchor] { var x = v.littleEndian; withUnsafeBytes(of: &x) { d.append(contentsOf: $0) } }
        d.append(bytes); return d
    }
    private static func decodeRaw(_ d: Data) -> RawRecord? {
        guard d.count >= 25, let s = BandSensor(rawValue: d[d.startIndex]) else { return nil }
        return RawRecord(sensor: s, arrival: u64(d, 1), wall: u64(d, 9), anchor: u64(d, 17), bytes: d.subdata(in: (d.startIndex + 25)..<d.endIndex))
    }

    private var checkpointURL: URL { dir.appendingPathComponent("core.checkpoint") }

    private func loadCheckpoint() -> (seq: UInt64, bytes: Data)? {
        guard let d = try? Data(contentsOf: checkpointURL), d.count > 16, d.prefix(4) == Data("MCK1".utf8) else { return nil }
        let seq = Self.u64(d, 4)
        let crc = (0..<4).reduce(UInt32(0)) { $0 | (UInt32(d[d.startIndex + 12 + $1]) << (8 * UInt32($1))) }
        let body = d.subdata(in: (d.startIndex + 16)..<d.endIndex)
        guard CRC32.checksum(body) == crc else { return nil }
        return (seq, body)
    }

    private func writeCheckpoint(seq: UInt64) throws {
        guard let c = core else { return }
        let ck = try c.checkpoint()
        var d = Data("MCK1".utf8)
        var s = seq.littleEndian, crc = CRC32.checksum(ck).littleEndian
        withUnsafeBytes(of: &s) { d.append(contentsOf: $0) }
        withUnsafeBytes(of: &crc) { d.append(contentsOf: $0) }
        d.append(ck)
        let tmp = checkpointURL.appendingPathExtension("tmp")
        try d.write(to: tmp)
        if let h = FileHandle(forWritingAtPath: tmp.path) { try? h.synchronize(); try? h.close() }
        try fire(.duringCheckpoint)                 // tmp 만 있고 rename 전: 구 checkpoint 가 유효해야 한다
        _ = try FileManager.default.replaceItemAt(checkpointURL, withItemAt: tmp)
    }

    private func recover() throws {
        try? FileManager.default.removeItem(at: checkpointURL.appendingPathExtension("tmp"))
        if let fm = try? Data(contentsOf: dir.appendingPathComponent("final.json")),
           let o = try? JSONSerialization.jsonObject(with: fm) as? [String: Any] { sealedFlag = true; finalManifest = Self.finalFrom(o) }
        gaps = AppendOnlyJournal.scan(url: dir.appendingPathComponent("gap.journal")).records.compactMap { r in
            guard let o = try? JSONSerialization.jsonObject(with: r.payload) as? [String: Any], let k = o["kind"] as? String, let s = o["start"] as? String else { return nil }
            return Gap(kind: k, bounded: (o["bounded"] as? Bool) ?? false, startSample: s, endMonotonicUs: (o["end_us"] as? String).flatMap { UInt64($0) })
        }
        let rawRecords = AppendOnlyJournal.scan(url: raw.url).records
        let rawLast = raw.lastSequence
        recoveredFromSequence = rawLast
        for r in rawRecords { if let rr = Self.decodeRaw(r.payload) { counters.packets[Self.name(rr.sensor), default: 0] += 1 } }

        // feature 마지막 sequence
        let featRecords = AppendOnlyJournal.scan(url: feature.url).records
        for r in featRecords {
            if let o = try? JSONSerialization.jsonObject(with: r.payload) as? [String: Any], let s = (o["sequence"] as? String).flatMap({ UInt64($0) }) { lastFeatureSeq = max(lastFeatureSeq, s) }
        }
        counters.metricWindows = UInt64(featRecords.count)

        if sealedFlag { return }
        // 코어: checkpoint 가 유효하면 복원, 아니면 처음부터
        var startSeq: UInt64 = 0
        if rawLast > 0 {
            if let ck = loadCheckpoint(), ck.seq <= rawLast, let restored = try? CoreBridge(configJSON: configJSON, restoring: ck.bytes) {
                core = restored; startSeq = ck.seq
            } else { recoveryUsedFullReplay = true }
        }
        if core == nil { core = try CoreBridge(configJSON: configJSON) }
        // checkpoint 이후 raw 재생. feature/outbox 는 sequence 멱등이므로 중복 기록되지 않는다.
        let replayFrom = startSeq
        for r in rawRecords where r.sequence > replayFrom {
            guard let rr = Self.decodeRaw(r.payload) else { continue }
            let out = try core!.push(sensor: rr.sensor, bytes: rr.bytes, arrivalMonotonicUs: rr.arrival, wallMs: rr.wall, anchorMonotonicUs: rr.anchor)
            counters.samples[Self.name(rr.sensor), default: 0] += UInt64(out.samples)
            for f in out.frames { try persist(frame: f, replaying: true) }
        }
        // feature 에는 있으나 outbox 에 없는 창(feature 기록 직후 크래시) 보충
        for r in AppendOnlyJournal.scan(url: feature.url).records {
            if let o = try? JSONSerialization.jsonObject(with: r.payload) as? [String: Any] { _ = try outbox.enqueue(o) }
        }
        sinceCheckpoint = 0
    }

    private static func name(_ s: BandSensor) -> String { s == .eeg ? "eeg" : s == .ppg ? "ppg" : "acc" }

    private static func finalFrom(_ o: [String: Any]) -> CoreFinal? {
        guard let fs = o["final_sequences"] as? [String: Any], let rs = o["raw_sha256"] as? String, let fh = o["feature_sha256"] as? String else { return nil }
        func s(_ k: String) -> String { (fs[k] as? String) ?? String(describing: fs[k] ?? "0") }
        return CoreFinal(eeg: s("eeg"), ppg: s("ppg"), acc: s("acc"), metric: s("metric"), segments: (o["segments"] as? Int) ?? 0, rawSha256: rs, featureSha256: fh)
    }

    /// 복구 후 BLE 가 다시 붙어 첫 패킷이 도착했을 때, 마지막 committed 와 그 사이를 bounded gap 으로 남긴다(복구 성공을 주장하지 않는다).
    public func markResumeAfterRecovery(firstMonotonicUs: UInt64) {
        lock.lock(); defer { lock.unlock() }
        let g = Gap(kind: "app_killed", bounded: true, startSample: String(recoveredFromSequence), endMonotonicUs: firstMonotonicUs)
        gaps.append(g)
        if let d = try? JSONSerialization.data(withJSONObject: ["kind": g.kind, "bounded": true, "start": g.startSample, "end_us": String(firstMonotonicUs)]) { _ = try? gapJournal.append(d) }
    }

    // MARK: 수집

    private func envelope(from f: CoreFrame) throws -> [String: Any] {
        var e = f.json
        e["session_id"] = ctx.sessionId; e["participant_id"] = ctx.participantId; e["stream_id"] = ctx.streamId
        e["stream_generation"] = String(ctx.streamGeneration); e["clock_anchor_id"] = ctx.clockAnchorId; e["clock_uncertainty_ms"] = ctx.clockUncertaintyMs
        e["device_profile_version"] = versions.profile; e["algorithm_version"] = versions.algorithm; e["model_version"] = versions.model
        if e["sqi"] == nil { e["sqi"] = NSNull() }
        return e
    }

    private func persist(frame f: CoreFrame, replaying: Bool) throws {
        guard let seq = UInt64(f.sequence) else { return }
        if seq <= lastFeatureSeq { return }            // 이미 영속됨(멱등)
        let env = try envelope(from: f)
        let data = try JSONSerialization.data(withJSONObject: env, options: [.sortedKeys])
        try feature.append(data)
        lastFeatureSeq = seq
        counters.metricWindows += 1
        if !replaying { try fire(.afterFeature) }
        try outbox.enqueue(env)
        if !replaying { try fire(.afterOutbox) }
        onFrame?(env)
    }

    public func ingest(sensor: BandSensor, bytes: Data, arrivalMonotonicUs: UInt64, wallMs: UInt64, anchorMonotonicUs: UInt64) throws {
        lock.lock(); defer { lock.unlock() }
        if sealedFlag { throw EngineError.sealed }
        if raw.byteSize + feature.byteSize + UInt64(bytes.count) + 64 > diskLimitBytes {
            blockedReason = "storage_full"             // silent overwrite 금지: 마지막 committed sample 은 그대로 둔다
            throw EngineError.storageFull
        }
        _ = try raw.append(Self.encodeRaw(sensor, bytes, arrivalMonotonicUs, wallMs, anchorMonotonicUs))
        try fire(.afterRaw)
        guard let core = core else { throw EngineError.core("closed") }
        let out: CorePushOutput
        do { out = try core.push(sensor: sensor, bytes: bytes, arrivalMonotonicUs: arrivalMonotonicUs, wallMs: wallMs, anchorMonotonicUs: anchorMonotonicUs) }
        catch let e as CoreBridgeError { throw EngineError.core("\(e)") }
        counters.packets[Self.name(sensor), default: 0] += 1
        counters.samples[Self.name(sensor), default: 0] += UInt64(out.samples)
        try fire(.afterCore)
        for f in out.frames { try persist(frame: f, replaying: false) }
        sinceCheckpoint += 1
        if sinceCheckpoint >= checkpointEvery { try writeCheckpoint(seq: raw.lastSequence); sinceCheckpoint = 0 }
    }

    /// 시간 경과 처리(공백 구간 gap 프레임). 장치 단조시계 기준으로 호출한다.
    public func advance(monotonicUs: UInt64) throws {
        lock.lock(); defer { lock.unlock() }
        guard !sealedFlag, let core = core else { return }
        for f in try core.advance(monotonicUs: monotonicUs) { try persist(frame: f, replaying: false) }
    }

    /// 종료: 코어 마감 → FinalManifest 영속 → 이후 ingest 거절. 멱등.
    @discardableResult
    public func seal() throws -> CoreFinal {
        lock.lock(); defer { lock.unlock() }
        if let f = finalManifest { return f }
        guard let core = core else { throw EngineError.core("closed") }
        let fin = try core.close()
        self.core = nil
        let o: [String: Any] = ["final_sequences": ["eeg": fin.eeg, "ppg": fin.ppg, "acc": fin.acc, "metric": fin.metric], "segments": fin.segments,
                                "raw_sha256": fin.rawSha256, "feature_sha256": fin.featureSha256]
        try JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]).write(to: dir.appendingPathComponent("final.json"), options: .atomic)
        finalManifest = fin; sealedFlag = true
        return fin
    }

    public var isSealed: Bool { lock.lock(); defer { lock.unlock() }; return sealedFlag }
}
