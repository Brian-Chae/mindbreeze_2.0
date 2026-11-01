import Foundation
import CryptoKit

/// SDD-270: 앱이 관측한 측정 구멍(gap)을 디스크에 먼저 남기는 내구 저장소(Android `GapEventStore.kt` 와 같은 형식·규칙).
/// 서버 `GapEventIn` 계약 그대로의 이벤트를 sequence 순으로 보관하고 전송 상태(pending/sent/rejected)를 함께 둔다.
/// event_id 는 (세션, 신호, 시작 시각)으로 정해지는 결정적 UUID(v3) — 복구 재생·재시도에서도 같은 구멍은 같은 id 다.
public final class GapEventStore {
    public struct Entry { public let event: [String: Any]; public let status: String; public let attempts: Int }
    public static let maxEvents = 2000
    public static let fileName = "gap-events.json"

    public let sessionId: String
    private let file: URL
    private let nowUs: () -> Int64
    private let lock = NSLock()

    public init(file: URL, sessionId: String, nowUs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1_000_000) }) {
        self.file = file; self.sessionId = sessionId; self.nowUs = nowUs
    }

    static func nameUUID(_ seed: String) -> String {
        var b = [UInt8](Insecure.MD5.hash(data: Data(seed.utf8)))
        b[6] = (b[6] & 0x0F) | 0x30; b[8] = (b[8] & 0x3F) | 0x80
        let c = Array(b.map { String(format: "%02x", $0) }.joined())
        return "\(String(c[0..<8]))-\(String(c[8..<12]))-\(String(c[12..<16]))-\(String(c[16..<20]))-\(String(c[20..<32]))"
    }

    private struct State { var next: Int64; var entries: [Entry] }

    private func load() -> State {
        guard let d = try? Data(contentsOf: file), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let arr = o["entries"] as? [[String: Any]] else { return State(next: 0, entries: []) }
        let es = arr.compactMap { x -> Entry? in
            guard let e = x["event"] as? [String: Any], let s = x["status"] as? String else { return nil }
            return Entry(event: e, status: s, attempts: (x["attempts"] as? Int) ?? 0)
        }
        return State(next: (o["next_sequence"] as? NSNumber)?.int64Value ?? 0, entries: es)
    }

    private func save(_ s: State) {
        let arr: [[String: Any]] = s.entries.map { ["event": $0.event, "status": $0.status, "attempts": $0.attempts] }
        guard let d = try? JSONSerialization.data(withJSONObject: ["next_sequence": s.next, "entries": arr], options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? d.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) // 저장 실패는 수집을 막지 않는다 — 같은 구멍은 같은 id 로 다시 적재된다
    }

    /// 구멍 적재. 이미 있는 구멍이면 nil(sequence 불변). 상한 초과분은 버린다.
    @discardableResult
    public func append(signal: String, streamId: String, segmentId: String, startUs: Int64, endUs: Int64?, reason: String, observedOrEstimated: String, reconnectCount: Int64) -> [String: Any]? {
        lock.lock(); defer { lock.unlock() }
        var s = load()
        let id = Self.nameUUID("mb-gap|\(sessionId)|\(signal)|\(startUs)")
        if s.entries.contains(where: { ($0.event["event_id"] as? String) == id }) || s.entries.count >= Self.maxEvents { return nil }
        let e: [String: Any] = ["event_type": "gap", "event_id": id, "sequence": s.next, "discovered_at_us": String(nowUs()), "signal": signal,
                                "stream_id": streamId, "segment_id": segmentId, "start_us": String(startUs), "end_us": endUs.map { String($0) as Any } ?? NSNull(),
                                "reason": reason, "observed_or_estimated": observedOrEstimated, "expected_samples": NSNull(), "received_samples": NSNull(), "reconnect_count": reconnectCount]
        s.next += 1; s.entries.append(Entry(event: e, status: "pending", attempts: 0))
        save(s)
        return e
    }

    public func pending(_ max: Int) -> [Entry] { lock.lock(); defer { lock.unlock() }; return Array(load().entries.filter { $0.status == "pending" }.prefix(max)) }
    public func hasPending() -> Bool { lock.lock(); defer { lock.unlock() }; return load().entries.contains { $0.status == "pending" } }
    public func lastSequence() -> Int64? { lock.lock(); defer { lock.unlock() }; let n = load().next; return n == 0 ? nil : n - 1 }
    public func statuses() -> [String] { lock.lock(); defer { lock.unlock() }; return load().entries.map { $0.status } }

    public func mark(_ ids: Set<String>, status: String) {
        lock.lock(); defer { lock.unlock() }
        var s = load()
        s.entries = s.entries.map { x in (x.status == "pending" && ids.contains((x.event["event_id"] as? String) ?? "")) ? Entry(event: x.event, status: status, attempts: x.attempts) : x }
        save(s)
    }

    /// 전송 실패 횟수(진단용). 횟수가 많아도 포기하지 않는다.
    public func noteAttempt() {
        lock.lock(); defer { lock.unlock() }
        var s = load()
        s.entries = s.entries.map { $0.status == "pending" ? Entry(event: $0.event, status: $0.status, attempts: $0.attempts + 1) : $0 }
        save(s)
    }
}

/// 밴드 끊김·앱 종료 시각(창 시간축 µs). 롤오버로 만들어진 구멍의 사유(ble_disconnect/process_terminated)를 가리는 데 쓴다.
public final class LinkDropLog {
    private let file: URL
    private let lock = NSLock()
    public init(file: URL) { self.file = file }
    public static let fileName = "link-drops.json"

    public func record(us: Int64, kind: String) {
        lock.lock(); defer { lock.unlock() }
        var a = loadLocked(); a.append(["us": String(us), "kind": kind])
        if let d = try? JSONSerialization.data(withJSONObject: a) { try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true); try? d.write(to: file, options: .atomic) }
    }
    private func loadLocked() -> [[String: String]] {
        guard let d = try? Data(contentsOf: file), let a = try? JSONSerialization.jsonObject(with: d) as? [[String: String]] else { return [] }
        return a
    }
    /// [startUs - slack, endUs + slack] 안의 가장 가까운 사유(없으면 nil).
    public func kind(startUs: Int64, endUs: Int64?, slackUs: Int64 = 2_000_000) -> String? {
        lock.lock(); defer { lock.unlock() }
        let hi = (endUs ?? startUs) + slackUs, lo = startUs - slackUs
        let hits = loadLocked().compactMap { x -> (Int64, String)? in guard let u = x["us"].flatMap(Int64.init), let k = x["kind"], u >= lo, u <= hi else { return nil }; return (u, k) }
        return hits.sorted { abs($0.0 - startUs) < abs($1.0 - startUs) }.first?.1
    }
}
