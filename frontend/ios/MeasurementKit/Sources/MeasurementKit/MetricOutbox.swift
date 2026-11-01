import Foundation

/// live metric 창의 영속 큐. 창 payload(MetricEnvelope 전체)는 journal 에 fsync 후에만 "접수"로 센다.
/// SDD-260: **REST `POST /features/batch` 응답(accepted/duplicate)만** acked 로 기록한다(소켓 ACK 로는 절대 acked 하지 않는다).
/// rejected 는 재전송하지 않고 격리 표시하되 pending(미완료)으로 남긴다. 서버 summary 에서 결측이 확인된 창은 unack 으로 되돌린다.
/// 레코드 JSON: {"k":"m","p":{...}} 창 / {"k":"a","s":[...]} ACK / {"k":"u","s":[...]} ACK 취소 / {"k":"r","s":[...],"c":"code"} 거절
public final class MetricOutbox {
    public struct Counts { public let livePending: Int, liveAcked: Int, rejected: Int, oldestPendingSeq: UInt64?, outOfRange: Int }
    /// 서버 eeg_feature_windows.window_index(Integer) 한도. 넘는 sequence 는 live 로 보내지 않는다(feature journal·archive 에는 남는다).
    public static let maxLiveSequence: UInt64 = 2_147_483_647

    private let journal: AppendOnlyJournal
    private let lock = NSLock()
    private var windows: [UInt64: Data] = [:]
    private var acked: Set<UInt64> = []
    private var rejected: Set<UInt64> = []
    private var rejectCodes: [UInt64: String] = [:]
    public private(set) var persistFailure = false
    private var outOfRange = 0

    public init(dir: URL, name: String = "metric-outbox.journal", sync: JournalSync = .full) throws {
        journal = try AppendOnlyJournal(url: dir.appendingPathComponent(name), sync: sync)
        for r in AppendOnlyJournal.scan(url: journal.url).records {
            guard let o = try? JSONSerialization.jsonObject(with: r.payload) as? [String: Any], let k = o["k"] as? String else { continue }
            switch k {
            case "m":
                if let p = o["p"] as? [String: Any], let seq = Self.seq(p), let d = try? JSONSerialization.data(withJSONObject: p, options: [.sortedKeys]) { windows[seq] = d }
            case "a": (o["s"] as? [String])?.compactMap { UInt64($0) }.forEach { acked.insert($0) }
            case "u": (o["s"] as? [String])?.compactMap { UInt64($0) }.forEach { acked.remove($0) }     // 서버 대조에서 결측 확인 → 재전송 대상
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
        if seq > Self.maxLiveSequence { outOfRange += 1; return seq }
        if windows[seq] != nil { return seq }
        let rec = try JSONSerialization.data(withJSONObject: ["k": "m", "p": envelope], options: [.sortedKeys])
        try journal.append(rec)
        windows[seq] = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
        return seq
    }

    // MARK: SDD-260 — REST 정본 저장용

    /// REST 전송 대상: 미ACK·미거절, **sequence 오름차순**(오래된 창부터 — 적체 해소가 최신창 방송보다 우선), 최대 max(≤300).
    public func restBatch(max: Int) -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        let seqs = windows.keys.filter { !acked.contains($0) && !rejected.contains($0) }.sorted().prefix(Swift.min(Swift.max(max, 0), 300))
        return seqs.compactMap { windows[$0].flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
    }

    /// 소켓 방송용: `after` 보다 큰 sequence 중 최신 count 개(오름차순). ACK 상태와 무관(방송은 저장이 아니다).
    public func broadcastWindows(after: UInt64, count: Int) -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        let seqs = windows.keys.filter { $0 > after }.sorted().suffix(Swift.max(count, 0))
        return seqs.compactMap { windows[$0].flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
    }

    /// 서버 summary 에 없다고 확인된 창을 다시 전송 대상으로 되돌린다(ACK 취소). 거절 격리 창은 건드리지 않는다. 반환: 되돌린 개수.
    @discardableResult
    public func unack(_ seqs: [UInt64]) -> Int {
        lock.lock(); defer { lock.unlock() }
        let fresh = seqs.filter { windows[$0] != nil && acked.contains($0) }
        guard !fresh.isEmpty else { return 0 }
        if let d = try? JSONSerialization.data(withJSONObject: ["k": "u", "s": fresh.map(String.init)]), (try? journal.append(d)) != nil { } else { persistFailure = true }
        fresh.forEach { acked.remove($0) }
        return fresh.count
    }

    /// 대조 대상(격리·범위 초과 제외 전부, ACK 여부 무관): (stream_id, sequence). stream_id 없는 창은 nil.
    public func localIdentities() -> [(stream: String?, seq: UInt64)] {
        lock.lock(); defer { lock.unlock() }
        return windows.keys.filter { !rejected.contains($0) }.sorted().map { s in
            let o = windows[s].flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            return (o?["stream_id"] as? String, s)
        }
    }

    public var maxLocalSequence: UInt64? { lock.lock(); defer { lock.unlock() }; return windows.keys.max() }

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
    /// 격리(rejected) 사유 코드. 재전송해도 같은 결과라 다시 보내지 않는다.
    public func rejectCode(_ seq: UInt64) -> String? { lock.lock(); defer { lock.unlock() }; return rejected.contains(seq) ? rejectCodes[seq] : nil }

    /// 전송 대상: 미ACK·미거절·전송중 아님, 최신창 우선, 최대 max(≤60).
    public func nextBatch(max: Int, excluding inflight: Set<UInt64>) -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        let seqs = windows.keys.filter { !acked.contains($0) && !rejected.contains($0) && !inflight.contains($0) }.sorted(by: >).prefix(Swift.min(max, 60))
        return seqs.compactMap { windows[$0].flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
    }

    public func counts() -> Counts {
        lock.lock(); defer { lock.unlock() }
        let pend = windows.keys.filter { !acked.contains($0) }
        return Counts(livePending: pend.filter { !rejected.contains($0) }.count, liveAcked: acked.count, rejected: rejected.count, oldestPendingSeq: pend.min(), outOfRange: outOfRange)
    }
}
