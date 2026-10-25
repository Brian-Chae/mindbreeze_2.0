import Foundation

/// live metric 창의 영속 큐. 창 payload(MetricEnvelope 전체)는 journal 에 fsync 후에만 "접수"로 센다.
/// 서버 ACK(accepted/duplicate + durable:true)가 온 창만 acked 로 기록한다. rejected 는 재전송하지 않고 격리 표시하되 pending(미완료)으로 남긴다.
/// 레코드 JSON: {"k":"m","p":{...}} 창 / {"k":"a","s":[...]} ACK / {"k":"r","s":[...],"c":"code"} 거절
public final class MetricOutbox {
    public struct Counts { public let livePending: Int, liveAcked: Int, rejected: Int, oldestPendingSeq: UInt64? }

    private let journal: AppendOnlyJournal
    private let lock = NSLock()
    private var windows: [UInt64: Data] = [:]
    private var acked: Set<UInt64> = []
    private var rejected: Set<UInt64> = []
    private var rejectCodes: [UInt64: String] = [:]
    public private(set) var persistFailure = false

    public init(dir: URL, name: String = "metric-outbox.journal", sync: JournalSync = .full) throws {
        journal = try AppendOnlyJournal(url: dir.appendingPathComponent(name), sync: sync)
        for r in AppendOnlyJournal.scan(url: journal.url).records {
            guard let o = try? JSONSerialization.jsonObject(with: r.payload) as? [String: Any], let k = o["k"] as? String else { continue }
            switch k {
            case "m":
                if let p = o["p"] as? [String: Any], let seq = Self.seq(p), let d = try? JSONSerialization.data(withJSONObject: p, options: [.sortedKeys]) { windows[seq] = d }
            case "a": (o["s"] as? [String])?.compactMap { UInt64($0) }.forEach { acked.insert($0) }
            case "r":
                for s in (o["s"] as? [String])?.compactMap({ UInt64($0) }) ?? [] { rejected.insert(s); rejectCodes[s] = o["c"] as? String }
            default: break
            }
        }
    }

    static func seq(_ p: [String: Any]) -> UInt64? { (p["sequence"] as? String).flatMap { UInt64($0) } ?? (p["sequence"] as? NSNumber)?.uint64Value }

    public enum OutboxError: Error { case missingSequence, encode }

    /// 창을 journal 에 fsync 한 뒤 접수한다. 같은 sequence 는 멱등(두 번째는 무시).
    @discardableResult
    public func enqueue(_ envelope: [String: Any]) throws -> UInt64 {
        guard let seq = Self.seq(envelope) else { throw OutboxError.missingSequence }
        lock.lock(); defer { lock.unlock() }
        if windows[seq] != nil { return seq }
        let rec = try JSONSerialization.data(withJSONObject: ["k": "m", "p": envelope], options: [.sortedKeys])
        try journal.append(rec)
        windows[seq] = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
        return seq
    }

    public func markAcked(_ seqs: [UInt64]) {
        lock.lock(); defer { lock.unlock() }
        let fresh = seqs.filter { windows[$0] != nil && !acked.contains($0) }
        guard !fresh.isEmpty else { return }
        if let d = try? JSONSerialization.data(withJSONObject: ["k": "a", "s": fresh.map(String.init)]), (try? journal.append(d)) != nil { } else { persistFailure = true }
        fresh.forEach { acked.insert($0); rejected.remove($0) }
    }

    public func markRejected(_ seqs: [UInt64], code: String?) {
        lock.lock(); defer { lock.unlock() }
        let fresh = seqs.filter { windows[$0] != nil && !rejected.contains($0) && !acked.contains($0) }
        guard !fresh.isEmpty else { return }
        if let d = try? JSONSerialization.data(withJSONObject: ["k": "r", "s": fresh.map(String.init), "c": code ?? ""]), (try? journal.append(d)) != nil { } else { persistFailure = true }
        fresh.forEach { rejected.insert($0); rejectCodes[$0] = code }
    }

    public var pendingSequences: [UInt64] { lock.lock(); defer { lock.unlock() }; return windows.keys.filter { !acked.contains($0) }.sorted() }
    public var ackedSequences: [UInt64] { lock.lock(); defer { lock.unlock() }; return acked.sorted() }
    public var rejectedSequences: [UInt64] { lock.lock(); defer { lock.unlock() }; return rejected.sorted() }

    /// 전송 대상: 미ACK·미거절·전송중 아님, 최신창 우선, 최대 max(≤60).
    public func nextBatch(max: Int, excluding inflight: Set<UInt64>) -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        let seqs = windows.keys.filter { !acked.contains($0) && !rejected.contains($0) && !inflight.contains($0) }.sorted(by: >).prefix(Swift.min(max, 60))
        return seqs.compactMap { windows[$0].flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
    }

    public func counts() -> Counts {
        lock.lock(); defer { lock.unlock() }
        let pend = windows.keys.filter { !acked.contains($0) }
        return Counts(livePending: pend.filter { !rejected.contains($0) }.count, liveAcked: acked.count, rejected: rejected.count, oldestPendingSeq: pend.min())
    }
}
