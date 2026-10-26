import Foundation

/// 큐를 인덱스 오름차순으로 업로드한다. 성공→삭제, 실패→지수 백오프, 401→refresh 1회, refresh 거부→auth_expired 후 정지(큐 보존).
public final class ChunkUploader: @unchecked Sendable {
    private let queue: ChunkQueue
    private let tokens: AudioTokenProvider
    private let http: AudioHTTPClient
    private let sleep: @Sendable (TimeInterval) async -> Void
    private let onEvent: @Sendable (RecorderEvent) -> Void

    private let lock = NSLock()
    private var task: Task<Void, Never>?
    private var rerun = false
    private var _uploaded = 0, _lastUploaded = -1

    public init(queue: ChunkQueue, tokens: AudioTokenProvider, http: AudioHTTPClient,
                sleep: @escaping @Sendable (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) },
                onEvent: @escaping @Sendable (RecorderEvent) -> Void) {
        self.queue = queue; self.tokens = tokens; self.http = http; self.sleep = sleep; self.onEvent = onEvent
    }

    public var uploadedCount: Int { lock.lock(); defer { lock.unlock() }; return _uploaded }
    public var lastUploadedIndex: Int { lock.lock(); defer { lock.unlock() }; return _lastUploaded }
    public func resetCounters() { lock.lock(); _uploaded = 0; _lastUploaded = -1; lock.unlock() }

    /// 큐가 빌 때까지(또는 취소·auth 만료까지) 업로드. 동시 호출은 하나의 실행으로 합쳐진다.
    public func drain() async {
        let t = claim()
        await t.value
    }
    public func cancel() { lock.lock(); task?.cancel(); lock.unlock() }

    private func claim() -> Task<Void, Never> {
        lock.lock(); defer { lock.unlock() }
        if let t = task { rerun = true; return t }
        let t = Task<Void, Never> { [self] in await run() }
        task = t
        return t
    }
    private func shouldContinue() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if rerun && !Task.isCancelled { rerun = false; return true }
        rerun = false; task = nil; return false
    }

    private func run() async {
        repeat {
            await loop()
        } while shouldContinue()
    }

    private enum Attempt { case success, authExpired, failed }

    private func loop() async {
        var attempt = 0
        var reportedFailure = false
        while !Task.isCancelled {
            guard let next = queue.pending().first else { return }
            switch await upload(next) {
            case .success:
                attempt = 0; reportedFailure = false
            case .authExpired:
                onEvent(.error(sessionId: next.sessionId, code: .authExpired, message: "인증이 만료되었습니다. 앱에서 다시 로그인하면 이어서 전송합니다.", recoverable: true))
                return
            case .failed:
                if !reportedFailure {
                    reportedFailure = true
                    onEvent(.error(sessionId: next.sessionId, code: .uploadFailed, message: "청크 업로드 실패 — 재시도 대기", recoverable: true))
                }
                await sleep(Backoff.delay(attempt: attempt)); attempt += 1
                await Task.yield()
            }
        }
    }

    private func upload(_ c: QueuedChunk) async -> Attempt {
        guard let cred = tokens.credential(), let data = try? Data(contentsOf: c.url) else { return .failed }
        var token = cred.accessToken
        var refreshed = false
        while true {
            guard let req = Self.makeRequest(apiBase: cred.apiBase, chunk: c, data: data, token: token) else { return .failed }
            let resp: AudioHTTPResponse
            do { resp = try await http.send(req) } catch { return .failed }
            if (200..<300).contains(resp.status) {
                queue.remove(sessionId: c.sessionId, index: c.index)
                lock.lock(); _uploaded += 1; _lastUploaded = max(_lastUploaded, c.index); let up = _uploaded; lock.unlock()
                onEvent(.chunkUploaded(sessionId: c.sessionId, index: c.index, size: c.size, uploaded: up, pending: queue.pendingCount(sessionId: c.sessionId)))
                return .success
            }
            if resp.status == 401, !refreshed {
                refreshed = true
                switch await tokens.refresh() {
                case .refreshed(let at): token = at; continue
                case .invalid: return .authExpired
                case .transient: return .failed
                }
            }
            if resp.status == 401 { return .authExpired }
            // 409/중복 등 서버가 이미 받은 경우는 멱등(2xx)으로 온다. 4xx 기타는 재시도 대상으로 둔다.
            return .failed
        }
    }

    static func makeRequest(apiBase: String, chunk: QueuedChunk, data: Data, token: String) -> URLRequest? {
        guard let url = URL(string: "\(apiBase)/sessions/\(chunk.sessionId)/audio/chunk") else { return nil }
        let boundary = "mb-" + UUID().uuidString
        var body = Data()
        func add(_ s: String) { body.append(Data(s.utf8)) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"chunk_index\"\r\n\r\n\(chunk.index)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"chunk-\(chunk.index).m4a\"\r\nContent-Type: audio/mp4\r\n\r\n")
        body.append(data); add("\r\n--\(boundary)--\r\n")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"; req.timeoutInterval = 30
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("capacitor", forHTTPHeaderField: "X-MB-Native")
        req.httpBody = body
        return req
    }
}
