import Foundation

/// SDD-260 N2 — 종료 후 서버 대조(feature). outbox 가 비면 `GET /features/summary` 로 서버 보유 집합을 받아
/// 로컬 sequence 집합 − 서버 보유 집합 = ∅ 일 때만 완료로 본다(contract §2: "빈 missing_ranges" 만으로 판정 금지).
/// 결측이 있으면 해당 창을 unack(재전송 대상)하고 `.resending(n)` 을 알린다 — 호출자가 FeatureUploader 를 깨우고 다시 `run` 한다.
/// 완료 마커(`feature-sync-complete.json`)가 있어야만 보관 정책이 삭제를 고려할 수 있다(이 트랙은 삭제하지 않는다).
public final class FeatureReconciler {
    public enum State: Equatable { case waiting, resending(Int), complete, failed }
    public static let markerName = "feature-sync-complete.json"

    private let outbox: MetricOutbox, http: HTTPClient
    private let apiBase: URL, sessionId: String, participantId: String?
    private let token: (Bool, @escaping (String?) -> Void) -> Void
    private let markerDir: URL
    private let lock = NSLock()
    private var running = false
    public init(outbox: MetricOutbox, uploader: FeatureUploader, http: HTTPClient, apiBase: URL, sessionId: String, participantId: String?,
                token: @escaping (Bool, @escaping (String?) -> Void) -> Void, markerDir: URL) {
        self.outbox = outbox; self.http = http; self.apiBase = apiBase; self.sessionId = sessionId; self.participantId = participantId
        self.token = token; self.markerDir = markerDir
    }

    public var isComplete: Bool { FileManager.default.fileExists(atPath: markerDir.appendingPathComponent(Self.markerName).path) }

    /// 순수 계산: 로컬 창 중 서버가 보유하지 않은 sequence(로컬 순서 유지). stream_id 없는 창은 비교할 수 없어 제외한다.
    /// 서버 보유 = stream 의 [min_index, max_index] − missing_ranges. truncated 면 마지막 range 끝 이후는 알 수 없으므로 결측으로 본다(재전송 후 수렴).
    public static func missing(local: [(stream: String?, seq: UInt64)], summary: [String: Any]) -> [UInt64] {
        struct Held { let lo: Int64, hi: Int64; let gaps: [(Int64, Int64)]; let truncated: Bool }
        var held: [String: Held] = [:]
        for s in (summary["streams"] as? [[String: Any]]) ?? [] {
            guard let id = s["stream_id"] as? String, let lo = (s["min_index"] as? NSNumber)?.int64Value, let hi = (s["max_index"] as? NSNumber)?.int64Value else { continue }
            let gaps: [(Int64, Int64)] = ((s["missing_ranges"] as? [[NSNumber]]) ?? []).compactMap { $0.count == 2 ? ($0[0].int64Value, $0[1].int64Value) : nil }
            held[id] = Held(lo: lo, hi: hi, gaps: gaps, truncated: (s["truncated"] as? Bool) ?? false)
        }
        var out: [UInt64] = []
        for (stream, seq) in local {
            guard let st = stream else { continue }
            guard let h = held[st] else { out.append(seq); continue }
            let i = Int64(clamping: seq)
            if i < h.lo || i > h.hi { out.append(seq); continue }
            if h.gaps.contains(where: { i >= $0.0 && i <= $0.1 }) { out.append(seq); continue }
            if h.truncated, let last = h.gaps.map({ $0.1 }).max(), i > last { out.append(seq) }
        }
        return out
    }

    /// 한 번 대조한다(동시 실행 1). completion 은 호출 스레드와 무관할 수 있다.
    public func run(_ completion: @escaping (State) -> Void) {
        if outbox.maxLocalSequence == nil { writeMarker(); completion(.complete); return }
        // 전송 대기 창이 남아 있으면 아직 대조하지 않는다(FeatureUploader 가 비운 뒤 onIdle 에서 다시 호출).
        if !outbox.restBatch(max: 1).isEmpty { completion(.waiting); return }
        lock.lock(); if running { lock.unlock(); completion(.waiting); return }; running = true; lock.unlock()
        let done: (State) -> Void = { [weak self] s in self?.lock.lock(); self?.running = false; self?.lock.unlock(); completion(s) }
        token(false) { [weak self] tk in
            guard let self = self, let tk = tk else { done(.failed); return }
            var comps = URLComponents(url: self.apiBase.appendingPathComponent("sessions").appendingPathComponent(self.sessionId).appendingPathComponent("features").appendingPathComponent("summary"), resolvingAgainstBaseURL: false)!
            if let p = self.participantId { comps.queryItems = [URLQueryItem(name: "participant_id", value: p)] }
            var r = URLRequest(url: comps.url!); r.httpMethod = "GET"; r.timeoutInterval = 20
            r.setValue("Bearer \(tk)", forHTTPHeaderField: "Authorization"); r.setValue("capacitor", forHTTPHeaderField: "X-MB-Native")
            self.http.send(r) { [weak self] res in
                guard let self = self else { return }
                guard case .success(let (status, data, _)) = res, status / 100 == 2, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { done(.failed); return }
                let miss = Self.missing(local: self.outbox.localIdentities(), summary: o)
                if miss.isEmpty { self.writeMarker(); done(.complete); return }
                let n = self.outbox.unack(miss)
                // 되돌린 창도, 이미 대기 중인 창도 없으면(결측이 로컬에서 설명 불가) 같은 상태를 반복하지 않도록 failed 로 알린다.
                done(n > 0 || !self.outbox.restBatch(max: 1).isEmpty ? .resending(max(n, miss.count)) : .failed)
            }
        }
    }

    private func writeMarker() {
        let o: [String: Any] = ["completed_at_ms": Int(Date().timeIntervalSince1970 * 1000), "session_id": sessionId]
        try? FileManager.default.createDirectory(at: markerDir, withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: o) { try? d.write(to: markerDir.appendingPathComponent(Self.markerName), options: .atomic) }
    }
}

/// SDD-260 N5 — 종료 후 서버 대조(원시). archive 큐가 비면 `GET /biosignal-raw/summary` 의 `aliases_uploaded` 와
/// 로컬 raw 항목(verified)을 비교해, 서버에 없는 alias 를 다시 큐에 올린다(presign → PUT → ack 재수행).
public final class RawReconciler {
    public enum State: Equatable { case waiting, resending(Int), complete, unverifiable, failed }
    public static let markerName = "archive-sync-complete.json"

    private let queue: ArchiveQueue, http: HTTPClient
    private let apiBase: URL, sessionId: String, participantId: String?
    private let token: (Bool, @escaping (String?) -> Void) -> Void
    private let markerDir: URL
    private let lock = NSLock()
    private var running = false
    public init(queue: ArchiveQueue, http: HTTPClient, apiBase: URL, sessionId: String, participantId: String?,
                token: @escaping (Bool, @escaping (String?) -> Void) -> Void, markerDir: URL) {
        self.queue = queue; self.http = http; self.apiBase = apiBase; self.sessionId = sessionId; self.participantId = participantId
        self.token = token; self.markerDir = markerDir
    }

    public var isComplete: Bool { FileManager.default.fileExists(atPath: markerDir.appendingPathComponent(Self.markerName).path) }

    public func run(_ completion: @escaping (State) -> Void) {
        let c = queue.counts
        if c.pending + c.uploading > 0 { completion(.waiting); return }
        let local = queue.all().filter { $0.kind == .raw && $0.state == .verified }
        if local.isEmpty { writeMarker(); completion(.complete); return }
        lock.lock(); if running { lock.unlock(); completion(.waiting); return }; running = true; lock.unlock()
        let done: (State) -> Void = { [weak self] s in self?.lock.lock(); self?.running = false; self?.lock.unlock(); completion(s) }
        token(false) { [weak self] tk in
            guard let self = self, let tk = tk else { done(.failed); return }
            var comps = URLComponents(url: self.apiBase.appendingPathComponent("sessions").appendingPathComponent(self.sessionId).appendingPathComponent("biosignal-raw").appendingPathComponent("summary"), resolvingAgainstBaseURL: false)!
            if let p = self.participantId { comps.queryItems = [URLQueryItem(name: "participant_id", value: p)] }
            var r = URLRequest(url: comps.url!); r.httpMethod = "GET"; r.timeoutInterval = 20
            r.setValue("Bearer \(tk)", forHTTPHeaderField: "Authorization"); r.setValue("capacitor", forHTTPHeaderField: "X-MB-Native")
            self.http.send(r) { [weak self] res in
                guard let self = self else { return }
                guard case .success(let (status, data, _)) = res, status / 100 == 2, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let aliases = o["aliases_uploaded"] as? [String] else { done(.failed); return }
                let have = Set(aliases)
                let miss = local.filter { !have.contains($0.alias) }
                if miss.isEmpty { self.writeMarker(); done(.complete); return }
                // 목록이 상한(5000)에서 잘렸으면 "없음"이 곧 "누락"이 아니다 → 완료도 재전송도 단정하지 않는다.
                if (o["aliases_truncated"] as? Bool) == true { done(.unverifiable); return }
                for m in miss { try? self.queue.requeue(alias: m.alias) }
                done(.resending(miss.count))
            }
        }
    }

    private func writeMarker() {
        let o: [String: Any] = ["completed_at_ms": Int(Date().timeIntervalSince1970 * 1000), "session_id": sessionId]
        try? FileManager.default.createDirectory(at: markerDir, withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: o) { try? d.write(to: markerDir.appendingPathComponent(Self.markerName), options: .atomic) }
    }
}
