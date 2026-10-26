import Foundation

// MARK: - T09 오류 분류 (frontend/src/lib/biosignal/archive-errors.ts 와 같은 규칙)

public enum ArchiveStage: String { case presign, put, verify }
/// represign=새 presign 재시도 / backoff=자동 재시도 / halt=권한·동의 거절(보존 중단) / quarantine=충돌·스키마·크기 격리 / timeReview=시간 미확정
public enum ArchiveAction: String { case represign, backoff, halt, quarantine, timeReview }

public struct ArchiveDecision: Equatable {
    public let stage: ArchiveStage, action: ArchiveAction, code: String
    public let retryAfterMs: Int?, splitCandidate: Bool
    public init(stage: ArchiveStage, action: ArchiveAction, code: String, retryAfterMs: Int?, splitCandidate: Bool) {
        self.stage = stage; self.action = action; self.code = code; self.retryAfterMs = retryAfterMs; self.splitCandidate = splitCandidate
    }
}

public enum ArchiveClassifier {
    public static let backoffBaseMs = 1000, backoffMaxMs = 60_000

    /// attempts 가 아무리 커도 유한 대기. retryAfter 가 더 크면 그 값을 쓴다. 횟수만으로 영구 실패를 만들지 않는다.
    public static func backoffMs(attempts: Int, retryAfterMs: Int? = nil) -> Int {
        let exp = min(backoffMaxMs, backoffBaseMs << min(max(0, attempts), 20))
        return max(exp, retryAfterMs ?? 0)
    }

    public static func classifyNetworkError(_ stage: ArchiveStage) -> ArchiveDecision {
        ArchiveDecision(stage: stage, action: .backoff, code: "network", retryAfterMs: nil, splitCandidate: false)
    }

    public static func classify(stage: ArchiveStage, status: Int, body: Data) -> ArchiveDecision {
        let o = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        let detail = o?["detail"] as? [String: Any]
        let code = detail?["code"] as? String, reason = detail?["reason"] as? String
        let retryAfter: Int? = {
            let v = (o?["retry_after"] ?? detail?["retry_after"]) as? NSNumber
            guard let d = v?.doubleValue, d.isFinite, d > 0 else { return nil }
            return Int(d * 1000)
        }()
        func d(_ a: ArchiveAction, _ c: String, split: Bool = false, ra: Int? = nil) -> ArchiveDecision {
            ArchiveDecision(stage: stage, action: a, code: c, retryAfterMs: ra, splitCandidate: split)
        }
        if status >= 500 || status == 408 || status == 429 { return d(.backoff, "http_\(status)", ra: retryAfter) }
        if status == 401 { return d(.backoff, "auth_refresh") }
        if status == 403 { return stage == .put ? d(.represign, "put_signature_expired") : d(.halt, reason ?? code ?? "forbidden") }
        if status == 404 { return stage == .verify ? d(.represign, "chunk_unknown") : d(.quarantine, code ?? "not_found") }
        if status == 409 { return code == "pending_time_review" ? d(.timeReview, reason ?? "pending_time_review") : d(.quarantine, code ?? "conflict") }
        if status == 413 { return d(.quarantine, "payload_too_large", split: true) }
        if status == 400 || status == 422 { return d(.quarantine, code ?? "http_\(status)") }
        return d(.backoff, "http_\(status)")
    }
}

// MARK: - 큐

public enum ArchiveKind: String { case raw, feature, rawDerived = "raw_derived", indices }
public enum ArchiveState: String { case pending, uploading, verified, pendingAuthorization = "pending_authorization", pendingTimeReview = "pending_time_review", quarantined }

public struct ArchiveItem {
    public var alias: String
    public var kind: ArchiveKind
    public var file: String                       // 큐 디렉터리 상대 파일명(불변 payload)
    public var sha256: String
    public var sizeBytes: Int
    public var captureStreamId: String?
    public var monotonicRange: (from: String, to: String)?
    public var state: ArchiveState = .pending
    public var attempts = 0
    public var lastCode: String?
    public var nextAttemptMs: Int = 0
    public var taskId: Int?
    public var uploadURL: String?
    public var remoteId: String?                  // 서버 발급 chunk_id/artifact_id (ACK 용)

    public init(alias: String, kind: ArchiveKind, file: String, sha256: String, sizeBytes: Int, captureStreamId: String?, monotonicRange: (String, String)?) {
        self.alias = alias; self.kind = kind; self.file = file; self.sha256 = sha256; self.sizeBytes = sizeBytes
        self.captureStreamId = captureStreamId; self.monotonicRange = monotonicRange.map { (from: $0.0, to: $0.1) }
    }

    var dict: [String: Any] {
        var d: [String: Any] = ["alias": alias, "kind": kind.rawValue, "file": file, "sha": sha256, "size": sizeBytes, "state": state.rawValue, "attempts": attempts, "next": nextAttemptMs]
        if let v = captureStreamId { d["stream"] = v }
        if let r = monotonicRange { d["from"] = r.from; d["to"] = r.to }
        if let v = lastCode { d["code"] = v }
        if let v = taskId { d["task"] = v }
        if let v = uploadURL { d["url"] = v }
        if let v = remoteId { d["rid"] = v }
        return d
    }
    static func from(_ d: [String: Any]) -> ArchiveItem? {
        guard let a = d["alias"] as? String, let k = (d["kind"] as? String).flatMap(ArchiveKind.init(rawValue:)), let f = d["file"] as? String,
              let s = d["sha"] as? String, let z = d["size"] as? Int, let st = (d["state"] as? String).flatMap(ArchiveState.init(rawValue:)) else { return nil }
        var i = ArchiveItem(alias: a, kind: k, file: f, sha256: s, sizeBytes: z, captureStreamId: d["stream"] as? String,
                            monotonicRange: (d["from"] as? String).flatMap { f in (d["to"] as? String).map { (f, $0) } })
        i.state = st; i.attempts = (d["attempts"] as? Int) ?? 0; i.nextAttemptMs = (d["next"] as? Int) ?? 0
        i.lastCode = d["code"] as? String; i.taskId = d["task"] as? Int; i.uploadURL = d["url"] as? String; i.remoteId = d["rid"] as? String
        return i
    }
}

public struct ArchiveCounts: Equatable {
    public var pending = 0, uploading = 0, verified = 0, pendingAuthorization = 0, pendingTimeReview = 0, quarantined = 0
}

/// 업로드 대기열. 상태 전이마다 journal 에 항목 스냅샷을 fsync 로 남기고(마지막 기록이 현재 상태), task_id↔항목 매핑도 같이 저장한다.
/// 재실행된 앱에서 OS 의 background URLSession 완료 callback 이 이 매핑으로 항목에 재연결된다.
public final class ArchiveQueue {
    public enum QueueError: Error, Equatable { case aliasBytesConflict, unknownAlias }
    private let journal: AppendOnlyJournal
    private var items: [String: ArchiveItem] = [:]
    private let lock = NSLock()

    public init(dir: URL, sync: JournalSync = .full) throws {
        journal = try AppendOnlyJournal(url: dir.appendingPathComponent("archive-queue.journal"), sync: sync)
        for r in AppendOnlyJournal.scan(url: journal.url).records {
            if let o = try? JSONSerialization.jsonObject(with: r.payload) as? [String: Any], let i = ArchiveItem.from(o) { items[i.alias] = i }
        }
    }

    private func persist(_ i: ArchiveItem) throws {
        try journal.append(JSONSerialization.data(withJSONObject: i.dict, options: [.sortedKeys]))
        items[i.alias] = i
    }

    /// 같은 alias·같은 bytes 는 멱등. 같은 alias 에 다른 bytes 는 거절(덮어쓰기 금지).
    public func enqueue(_ item: ArchiveItem) throws {
        lock.lock(); defer { lock.unlock() }
        if let cur = items[item.alias] {
            if cur.sha256 == item.sha256 && cur.sizeBytes == item.sizeBytes { return }
            throw QueueError.aliasBytesConflict
        }
        try persist(item)
    }

    public func item(alias: String) -> ArchiveItem? { lock.lock(); defer { lock.unlock() }; return items[alias] }
    public func item(forTask id: Int) -> ArchiveItem? { lock.lock(); defer { lock.unlock() }; return items.values.first { $0.taskId == id } }

    public func attach(taskId: Int, alias: String, url: String, remoteId: String? = nil) throws {
        lock.lock(); defer { lock.unlock() }
        guard var i = items[alias] else { throw QueueError.unknownAlias }
        i.taskId = taskId; i.uploadURL = url; i.state = .uploading; if let r = remoteId { i.remoteId = r }
        try persist(i)
    }

    public func markVerified(alias: String) throws {
        lock.lock(); defer { lock.unlock() }
        guard var i = items[alias] else { throw QueueError.unknownAlias }
        i.state = .verified; i.taskId = nil; i.uploadURL = nil; i.lastCode = nil; i.remoteId = nil
        try persist(i)
    }

    public func apply(_ d: ArchiveDecision, alias: String, now: Int) throws {
        lock.lock(); defer { lock.unlock() }
        guard var i = items[alias] else { throw QueueError.unknownAlias }
        i.taskId = nil; i.uploadURL = nil; i.lastCode = d.code
        switch d.action {
        case .represign: i.state = .pending; i.nextAttemptMs = now
        case .backoff:
            i.state = .pending; i.attempts += 1
            i.nextAttemptMs = now + ArchiveClassifier.backoffMs(attempts: i.attempts - 1, retryAfterMs: d.retryAfterMs)
        case .halt: i.state = .pendingAuthorization
        case .timeReview: i.state = .pendingTimeReview
        case .quarantine: i.state = .quarantined
        }
        try persist(i)
    }

    /// 재실행 직후: 업로드 중이던 항목 중 OS 에 살아 있는 task 가 없는 것을 pending 으로 되돌린다.
    public func releaseOrphans(liveTaskIds: Set<Int>) throws {
        lock.lock(); defer { lock.unlock() }
        for var i in items.values where i.state == .uploading && !(i.taskId.map(liveTaskIds.contains) ?? false) {
            i.state = .pending; i.taskId = nil; i.uploadURL = nil; try persist(i)
        }
    }

    public func dueItems(now: Int) -> [ArchiveItem] {
        lock.lock(); defer { lock.unlock() }
        return items.values.filter { $0.state == .pending && $0.nextAttemptMs <= now }.sorted { $0.alias < $1.alias }
    }

    public var counts: ArchiveCounts {
        lock.lock(); defer { lock.unlock() }
        var c = ArchiveCounts()
        for i in items.values {
            switch i.state {
            case .pending: c.pending += 1
            case .uploading: c.uploading += 1
            case .verified: c.verified += 1
            case .pendingAuthorization: c.pendingAuthorization += 1
            case .pendingTimeReview: c.pendingTimeReview += 1
            case .quarantined: c.quarantined += 1
            }
        }
        return c
    }
}

// MARK: - 요청 본문 (T09 계약)

public enum ArchiveRequests {
    /// presign 본문. `capture_stream_id` 는 있을 때만(없으면 v1/v2 와 동일한 본문), `monotonic_range` 는 서버가 종료 이후 사후전송을 판정하는 근거.
    public static func presignBody(_ item: ArchiveItem, participantId: String?, playGroupId: String? = nil) -> [String: Any] {
        var chunk: [String: Any] = [item.kind == .raw ? "chunk_alias" : "artifact_alias": item.alias, "checksum": item.sha256, "size_bytes": item.sizeBytes]
        if item.kind != .raw { chunk["artifact_kind"] = item.kind.rawValue }
        if let r = item.monotonicRange { chunk["monotonic_range"] = ["from_us": r.from, "to_us": r.to] }
        var body: [String: Any] = ["participant_id": participantId as Any? ?? NSNull(), "play_group_id": playGroupId as Any? ?? NSNull(), "chunks": [chunk]]
        if let s = item.captureStreamId { body["capture_stream_id"] = s }
        return body
    }
}
