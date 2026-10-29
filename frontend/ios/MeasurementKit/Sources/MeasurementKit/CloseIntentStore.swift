import Foundation
import CryptoKit

/// 네이티브 종료 기록(biosignal close intent). Android `CloseIntentStore.kt`, 웹 `capture-session.ts close()` 와 같은 서버 계약(`CloseIntentIn`)이다.
///
/// 종료(stop) 때 ArchiveQueue 에 든 raw·feature 항목으로 expected set 을 만들어 디스크에 먼저 쓰고(서버 응답 이전),
/// 업로드가 끝난 뒤 `POST /sessions/{sid}/biosignal-events` 로 보낸다. 같은 내용이면 intent_id 가 같아 서버가 멱등 처리한다.
/// 서버는 JS 가 따로 보낸 intent(indices·normalization)와 합집합으로 판정한다(`_merged_intent`).
public final class CloseIntentStore {
    public struct Pending { public let intent: [String: Any]; public let participantId: String?; public let attempts: Int }
    public static let maxAttempts = 12
    public static let fileName = "close-intent.json"

    private let file: URL
    private let lock = NSLock()

    public init(file: URL) { self.file = file }

    /// 안드로이드 `UUID.nameUUIDFromBytes` 와 같은 결과(MD5, version 3). 같은 입력이면 두 플랫폼의 intent_id 가 같다.
    static func nameUUID(_ seed: String) -> String {
        var b = [UInt8](Insecure.MD5.hash(data: Data(seed.utf8)))
        b[6] = (b[6] & 0x0F) | 0x30; b[8] = (b[8] & 0x3F) | 0x80
        let h = b.map { String(format: "%02x", $0) }.joined()
        let c = Array(h)
        return "\(String(c[0..<8]))-\(String(c[8..<12]))-\(String(c[12..<16]))-\(String(c[16..<20]))-\(String(c[20..<32]))"
    }

    /// 종료 시점 큐 스냅샷으로 intent 를 만들어 저장한다. 큐에 raw·feature 가 없으면 만들지 않는다(nil). 같은 내용이 이미 있으면 다시 쓰지 않는다.
    @discardableResult
    public func record(queue: ArchiveQueue, sessionId: String, participantId: String?, reason: String, nowUs: Int64) -> [String: Any]? {
        lock.lock(); defer { lock.unlock() }
        let items = queue.all().filter { $0.kind == .raw || $0.kind == .feature }
        if items.isEmpty { return nil }
        var expected: [[String: Any]] = []
        var order: [String] = []
        var streams: [String: (stream: String, segment: String, signal: String, lastChunk: Int, samples: Int)] = [:]
        for i in items {
            expected.append(["kind": i.kind.rawValue, "alias": i.alias, "sha256": (i.meta?["checksum"] as? String) ?? i.sha256])
            guard i.kind == .raw, let h = i.meta?["header"] as? [String: Any],
                  let st = h["stream_id"] as? String, let sg = h["segment_id"] as? String, let sig = h["signal_type"] as? String else { continue }
            let key = "\(st)|\(sg)|\(sig)"
            var agg = streams[key] ?? (st, sg, sig, -1, 0)
            if !order.contains(key) { order.append(key) }
            agg.lastChunk = max(agg.lastChunk, (h["chunk_index"] as? Int) ?? -1); agg.samples += (h["sample_count"] as? Int) ?? 0
            streams[key] = agg
        }
        // feature 순번은 코어 프레임 순번(1부터)이라 서버의 0..last 구멍 판정과 맞지 않아 보내지 않는다 — feature 는 expected set 으로 대조한다.
        let streamArr: [[String: Any]] = order.compactMap { k in
            streams[k].map { ["stream_id": $0.stream, "segment_id": $0.segment, "signal": $0.signal,
                              "last_chunk_sequence": $0.lastChunk >= 0 ? $0.lastChunk as Any : NSNull(), "last_feature_sequence": NSNull(), "received_samples": $0.samples] }
        }
        let intentId = Self.nameUUID("mb-close-intent|\(sessionId)|" + items.map { $0.alias }.sorted().joined(separator: ","))
        if let prev = load(), (prev.intent["intent_id"] as? String) == intentId { return prev.intent }
        let intent: [String: Any] = ["event_type": "close_intent", "intent_id": intentId, "expected_artifacts": expected, "streams": streamArr,
                                     "snapshots": [Any](), "last_gap_sequence": NSNull(), "end_reason": String(reason.prefix(64)), "closed_at_us": String(nowUs)]
        save(intent, participantId: participantId, sent: false, attempts: 0)
        return intent
    }

    /// 아직 서버가 받지 않은 intent(없으면 nil). 재시도 한도를 넘으면 더 보내지 않는다.
    public func pending() -> Pending? {
        lock.lock(); defer { lock.unlock() }
        guard let s = load(), !s.sent, s.attempts < Self.maxAttempts else { return nil }
        return Pending(intent: s.intent, participantId: s.participantId, attempts: s.attempts)
    }

    public func markSent() { lock.lock(); defer { lock.unlock() }; if let s = load() { save(s.intent, participantId: s.participantId, sent: true, attempts: s.attempts) } }
    public func markAttempt() { lock.lock(); defer { lock.unlock() }; if let s = load() { save(s.intent, participantId: s.participantId, sent: false, attempts: s.attempts + 1) } }

    private func load() -> (intent: [String: Any], participantId: String?, sent: Bool, attempts: Int)? {
        guard let d = try? Data(contentsOf: file), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let i = o["intent"] as? [String: Any] else { return nil }
        return (i, o["participant_id"] as? String, (o["sent"] as? Bool) ?? false, (o["attempts"] as? Int) ?? 0)
    }

    private func save(_ intent: [String: Any], participantId: String?, sent: Bool, attempts: Int) {
        let o: [String: Any] = ["intent": intent, "participant_id": participantId as Any? ?? NSNull(), "sent": sent, "attempts": attempts]
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? d.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) // 저장 실패해도 다음 종료/재시도에서 다시 만든다
    }
}
