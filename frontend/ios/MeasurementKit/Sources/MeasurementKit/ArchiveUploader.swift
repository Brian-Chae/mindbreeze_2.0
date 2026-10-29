import Foundation
import CryptoKit

public enum Hashing {
    public static func sha256Hex(_ d: Data) -> String { SHA256.hash(data: d).map { String(format: "%02x", $0) }.joined() }
    public static func sha256Hex(file: URL) -> String? {
        guard let h = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? h.close() }
        var sha = SHA256()
        while let chunk = try? h.read(upToCount: 1 << 20), !chunk.isEmpty { sha.update(data: chunk) }
        return sha.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

/// 파일 기반 업로드 실행기(background URLSession 어댑터). 시험에서는 가짜로 대체한다.
public protocol FileUploading: AnyObject {
    /// 파일을 PUT 하는 task 를 시작하고 task 식별자를 돌려준다. task 는 앱이 죽어도 OS 가 이어 간다.
    func startUpload(to url: URL, headers: [String: String], file: URL, alias: String) -> Int
    func liveTaskIds() -> Set<Int>
}

/// presign(JSON 제어 요청) → 파일 PUT(background) → ACK(검증) 파이프라인. 라이브 1Hz 경로와 분리된 archive 전용이다.
/// 완료 기준: 서버 verify ACK 의 `upload_status == uploaded` + `verified_at_us != null` 뿐(PUT HTTP 200 만으로 receipt 를 만들지 않음).
public final class ArchiveUploader {
    public static let maxConcurrent = 2
    private let queue: ArchiveQueue, http: HTTPClient, files: FileUploading
    public var queueRef: ArchiveQueue { queue }
    private let apiBase: URL, sessionId: String, participantId: String?
    private let token: (@escaping (String?) -> Void) -> Void
    private let fileURL: (ArchiveItem) -> URL
    private let nowMs: () -> Int
    public var onChange: (() -> Void)?
    /// 종료 기록(close intent) 저장소. 있으면 업로드가 한 차례 끝난 뒤 `biosignal-events` 로 보낸다.
    public var closeIntents: CloseIntentStore?
    /// 전송 실패 뒤 재시도 예약(초, 실행할 일). 호스트가 주입한다. 없으면 다음 pump(앱 시작·큐 변화·네트워크 복귀)에서 재시도한다.
    public var scheduleRetry: ((Double, @escaping () -> Void) -> Void)?
    private var sendingIntent = false
    /// presign 요청이 진행 중인 항목(alias). attach 전(pending)에는 `counts.uploading` 에 잡히지 않아,
    /// 복귀 직후 pump 가 연속 호출되면 같은 항목에 presign 을 중복 발사해 서버 풀을 고갈시켰다(dev 사고).
    private var inFlight = Set<String>()
    private let inFlightLock = NSLock()
    func inFlightCount() -> Int { inFlightLock.lock(); defer { inFlightLock.unlock() }; return inFlight.count }
    private func claim(_ alias: String) -> Bool { inFlightLock.lock(); defer { inFlightLock.unlock() }; return inFlight.insert(alias).inserted }
    private func release(_ alias: String) { inFlightLock.lock(); inFlight.remove(alias); inFlightLock.unlock() }
    public static let intentRetrySeconds = 30.0

    public init(queue: ArchiveQueue, http: HTTPClient, files: FileUploading, apiBase: URL, sessionId: String, participantId: String?,
                token: @escaping (@escaping (String?) -> Void) -> Void, fileURL: @escaping (ArchiveItem) -> URL, nowMs: @escaping () -> Int) {
        self.queue = queue; self.http = http; self.files = files; self.apiBase = apiBase; self.sessionId = sessionId
        self.participantId = participantId; self.token = token; self.fileURL = fileURL; self.nowMs = nowMs
    }

    private func path(_ kind: ArchiveKind, _ op: String) -> URL {
        apiBase.appendingPathComponent("sessions").appendingPathComponent(sessionId)
            .appendingPathComponent(kind == .raw ? "biosignal-raw" : "biosignal-artifacts").appendingPathComponent(op)
    }

    private func post(_ url: URL, _ body: [String: Any], _ tk: String, _ done: @escaping (Result<(Int, Data, [String: String]), Error>) -> Void) {
        var r = URLRequest(url: url); r.httpMethod = "POST"; r.timeoutInterval = 20
        r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("Bearer \(tk)", forHTTPHeaderField: "Authorization")
        r.setValue("capacitor", forHTTPHeaderField: "X-MB-Native")
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        http.send(r, completion: done)
    }

    /// 실행 기회마다 호출(큐 변화·네트워크 복귀·앱 시작). 동시 2개까지만 시작한다.
    public func pump() {
        token { [weak self] tk in
            guard let self = self, let tk = tk else { return }
            let due = self.queue.dueItems(now: self.nowMs())
            // 시작할 항목이 없고 업로드 중인 것도 없을 때(= 한 차례 drain 이 끝났을 때) 종료 기록을 보낸다.
            if due.isEmpty, self.queue.counts.uploading == 0 { self.sendPendingCloseIntent(tk) }
            for item in due {
                // 동시 상한에 presign 단계(inFlight)도 포함한다. 이미 presign 중인 항목은 건너뛴다.
                if self.queue.counts.uploading + self.inFlightCount() >= Self.maxConcurrent { break }
                guard self.claim(item.alias) else { continue }
                self.begin(item, tk)
            }
        }
    }

    /// 종료 기록 전송: `POST /sessions/{sid}/biosignal-events`. 서버는 intent_id 기준 멱등(recorded/duplicate)이라 재전송이 안전하다.
    /// 서버가 받았으면(recorded·duplicate·conflict) 닫는다 — conflict 는 같은 id 다른 내용이라 다시 보내도 같다. 4xx(401/408/429 제외)도 같은 본문으로 영영 통과 못 하므로 닫는다.
    /// 네트워크/5xx/인증은 시도 횟수를 올리고 재시도한다(최대 12회).
    private func sendPendingCloseIntent(_ tk: String) {
        guard let store = closeIntents, !sendingIntent, let p = store.pending() else { return }
        sendingIntent = true
        let url = apiBase.appendingPathComponent("sessions").appendingPathComponent(sessionId).appendingPathComponent("biosignal-events")
        post(url, ["participant_id": (p.participantId ?? participantId) as Any? ?? NSNull(), "events": [p.intent]], tk) { [weak self] r in
            guard let self = self else { return }
            self.sendingIntent = false
            var done = false
            if case .success(let (status, body, _)) = r {
                if status / 100 == 2 {
                    let o = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
                    let st = ((o?["events"] as? [[String: Any]])?.first?["status"]) as? String
                    done = st == "recorded" || st == "duplicate" || st == "conflict"
                } else {
                    done = status / 100 == 4 && status != 401 && status != 408 && status != 429
                }
            }
            if done { store.markSent() } else {
                store.markAttempt()
                if store.pending() != nil { self.scheduleRetry?(Self.intentRetrySeconds) { [weak self] in self?.pump() } }
            }
            self.onChange?()
        }
    }

    private func begin(_ item: ArchiveItem, _ tk: String) {
        let url = fileURL(item)
        guard let actual = Hashing.sha256Hex(file: url), actual == item.sha256 else {
            try? queue.apply(ArchiveDecision(stage: .presign, action: .quarantine, code: FileManager.default.fileExists(atPath: url.path) ? "local_hash_mismatch" : "local_file_missing", retryAfterMs: nil, splitCandidate: false), alias: item.alias, now: nowMs())
            release(item.alias); onChange?(); return
        }
        post(path(item.kind, "presign"), ArchiveRequests.presignBody(item, participantId: participantId), tk) { [weak self] r in
            guard let self = self else { return }
            defer { self.release(item.alias) }     // attach/fail 처리 뒤에 해제(그 사이 중복 presign 차단)
            switch r {
            case .failure: self.fail(item.alias, ArchiveClassifier.classifyNetworkError(.presign))
            case .success(let (status, body, _)):
                guard status / 100 == 2 else { self.fail(item.alias, ArchiveClassifier.classify(stage: .presign, status: status, body: body)); return }
                guard let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any], let c = (o["chunks"] as? [[String: Any]])?.first else {
                    self.fail(item.alias, ArchiveDecision(stage: .presign, action: .backoff, code: "bad_presign_response", retryAfterMs: nil, splitCandidate: false)); return
                }
                let rid = (c["chunk_id"] ?? c["artifact_id"]) as? String
                if (c["upload_status"] as? String) == "uploaded", c["upload_url"] is NSNull || c["upload_url"] == nil {
                    self.ack(item.alias, tk); return     // 이미 서버가 보유(멱등 재제출): 검증 ACK 만 수행
                }
                guard let us = c["upload_url"] as? String, let u = URL(string: us) else {
                    self.fail(item.alias, ArchiveDecision(stage: .presign, action: .backoff, code: "no_upload_url", retryAfterMs: nil, splitCandidate: false)); return
                }
                let headers = (c["upload_headers"] as? [String: String]) ?? [:]
                let id = self.files.startUpload(to: u, headers: headers, file: url, alias: item.alias)
                try? self.queue.attach(taskId: id, alias: item.alias, url: us, remoteId: rid)
                self.onChange?()
            }
        }
    }

    /// background URLSession 의 task 완료 callback(앱 재실행 후에도 task_id 매핑으로 연결됨).
    public func uploadCompleted(taskId: Int, status: Int, error: Error?) {
        guard let item = queue.item(forTask: taskId) else { return }     // 알 수 없는 task 는 무시
        if error != nil { fail(item.alias, ArchiveClassifier.classifyNetworkError(.put)); return }
        guard status / 100 == 2 else { fail(item.alias, ArchiveClassifier.classify(stage: .put, status: status, body: Data())); return }
        token { [weak self] tk in
            guard let self = self else { return }
            guard let tk = tk else { self.fail(item.alias, ArchiveDecision(stage: .verify, action: .backoff, code: "auth_refresh", retryAfterMs: nil, splitCandidate: false)); return }
            self.ack(item.alias, tk)
        }
    }

    private func ack(_ alias: String, _ tk: String) {
        guard let item = queue.item(alias: alias), let rid = item.remoteId else { return }
        let key = item.kind == .raw ? "chunk_id" : "artifact_id"
        post(path(item.kind, "ack"), ["participant_id": participantId as Any? ?? NSNull(), "chunks": [[key: rid, "checksum": item.sha256, "size_bytes": item.sizeBytes]]], tk) { [weak self] r in
            guard let self = self else { return }
            switch r {
            case .failure: self.fail(alias, ArchiveClassifier.classifyNetworkError(.verify))
            case .success(let (status, body, _)):
                guard status / 100 == 2 else { self.fail(alias, ArchiveClassifier.classify(stage: .verify, status: status, body: body)); return }
                let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
                let c = (o?["chunks"] as? [[String: Any]])?.first { (($0["chunk_id"] ?? $0["artifact_id"]) as? String) == rid }
                if let c = c, (c["upload_status"] as? String) == "uploaded", c["verified_at_us"] != nil, !(c["verified_at_us"] is NSNull) {
                    try? self.queue.markVerified(alias: alias); self.onChange?(); self.pump()
                } else {
                    self.fail(alias, ArchiveDecision(stage: .verify, action: .backoff, code: (c?["failure_reason"] as? String) ?? "unverified", retryAfterMs: nil, splitCandidate: false))
                }
            }
        }
    }

    private func fail(_ alias: String, _ d: ArchiveDecision) {
        try? queue.apply(d, alias: alias, now: nowMs()); onChange?()
        if d.action == .represign { pump() }
    }
}

/// 고정 identifier 의 background URLSession. 앱이 종료돼도 OS 가 전송을 이어 가고 완료 시 앱을 다시 깨운다.
/// 시스템이 스케줄하므로 지연될 수 있다 — 이 경로는 archive 전용이며 1Hz 원격 표시의 대체가 아니다.
public final class BackgroundFileUploader: NSObject, FileUploading, URLSessionTaskDelegate, URLSessionDelegate {
    public static let sessionIdentifier = "com.looxidlabs.mindbreeze2.archive.upload"
    public var onCompleted: ((Int, Int, Error?) -> Void)?
    public var backgroundCompletionHandler: (() -> Void)?
    private var session: URLSession!
    private var live = Set<Int>()
    private let lock = NSLock()

    public override init() {
        super.init()
        let cfg = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        cfg.sessionSendsLaunchEvents = true; cfg.isDiscretionary = false; cfg.waitsForConnectivity = true
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
        session.getAllTasks { [weak self] tasks in
            self?.lock.lock(); tasks.forEach { self?.live.insert($0.taskIdentifier) }; self?.lock.unlock()
        }
    }

    public func startUpload(to url: URL, headers: [String: String], file: URL, alias: String) -> Int {
        var r = URLRequest(url: url); r.httpMethod = "PUT"
        headers.forEach { r.setValue($1, forHTTPHeaderField: $0) }
        let t = session.uploadTask(with: r, fromFile: file)
        t.taskDescription = alias
        lock.lock(); live.insert(t.taskIdentifier); lock.unlock()
        t.resume()
        return t.taskIdentifier
    }
    public func liveTaskIds() -> Set<Int> { lock.lock(); defer { lock.unlock() }; return live }

    public func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock(); live.remove(task.taskIdentifier); lock.unlock()
        onCompleted?(task.taskIdentifier, (task.response as? HTTPURLResponse)?.statusCode ?? 0, error)
    }
    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in self?.backgroundCompletionHandler?(); self?.backgroundCompletionHandler = nil }
    }
}
