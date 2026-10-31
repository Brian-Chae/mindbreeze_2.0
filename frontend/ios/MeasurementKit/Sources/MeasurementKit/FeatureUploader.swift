import Foundation

/// SDD-260 N1 — feature(리포트 입력) **정본 저장 경로**. outbox 의 미ACK 창을 오래된 순서로 ≤60창씩 REST 로 보낸다.
/// `POST /sessions/{sid}/features/batch` 응답(accepted/duplicate)만 outbox 를 acked 로 만든다. 소켓 live:metric 은 방송 전용이라 관여하지 않는다.
/// - 5초 주기 + 트리거(`kick`: 종료 직후·앱 시작·포그라운드·네트워크 복귀). 동시 요청 1.
/// - 격리(거절) 코드는 4종뿐: consent_withdrawn · participant_mismatch · stream_not_owned · hash_conflict. 그 밖의 코드·네트워크·5xx·타임아웃·401 은 full jitter 로 무한 재시도.
/// - 422(요청 전체 검증 실패)는 poison 창 하나가 전체를 막지 않도록 1창씩 분리하고, 단일 창이 422 면 그 창만 invalid_message 로 격리한다.
/// 호출은 단일 직렬 큐 전제(호스트 큐)이나 상태는 락으로 보호한다.
public final class FeatureUploader {
    public static let period: TimeInterval = 5
    public static let batchSize = 60
    /// 적체가 남았을 때 다음 배치까지의 짧은 간격(5초를 기다리지 않는다).
    public static let drainDelay: TimeInterval = 0.2
    public static let maxBackoff: TimeInterval = 60
    /// 재시도 지연 하한 — full jitter 가 0 에 가까워도 핫루프가 되지 않게 한다.
    public static let minRetryDelay: TimeInterval = 0.1
    public static let quarantineCodes: Set<String> = ["consent_withdrawn", "participant_mismatch", "stream_not_owned", "hash_conflict"]

    private let outbox: MetricOutbox
    private let http: HTTPClient
    private let scheduler: Scheduler
    private let apiBase: URL, sessionId: String, participantId: String?
    private let token: (Bool, @escaping (String?) -> Void) -> Void
    private let jitter: (Double) -> Double
    private let lock = NSRecursiveLock()

    private var inFlight = false
    private var failures = 0
    private var forceRefresh = false
    private var isolate = false
    private var stopped = false
    private var periodTimer: Cancellable?, retryTimer: Cancellable?, drainTimer: Cancellable?
    /// 보낼 창이 없을 때(= 큐가 비었을 때). 종료 대조(N2)가 이 시점에 시작한다.
    public var onIdle: (() -> Void)?
    /// ACK·격리·실패로 outbox 상태가 바뀐 뒤.
    public var onChange: (() -> Void)?
    public private(set) var lastFailureCode: String?

    /// - token: (forceRefresh, done) — nil 이면 토큰 없음(재시도). 401 다음 시도에서는 forceRefresh=true.
    /// - jitter: 상한(초) → 실제 대기(초). 운영은 `Double.random(in: 0...cap)`(full jitter).
    public init(outbox: MetricOutbox, http: HTTPClient, scheduler: Scheduler, apiBase: URL, sessionId: String, participantId: String?,
                token: @escaping (Bool, @escaping (String?) -> Void) -> Void, jitter: @escaping (Double) -> Double = { Double.random(in: 0...$0) }) {
        self.outbox = outbox; self.http = http; self.scheduler = scheduler; self.apiBase = apiBase
        self.sessionId = sessionId; self.participantId = participantId; self.token = token; self.jitter = jitter
    }

    /// 5초 주기 타이머를 켜고 즉시 한 번 시도한다.
    public func start() {
        lock.lock(); stopped = false; lock.unlock()
        armPeriod()
        attempt(external: true)
    }

    public func stop() {
        lock.lock(); stopped = true
        periodTimer?.cancel(); periodTimer = nil; retryTimer?.cancel(); retryTimer = nil; drainTimer?.cancel(); drainTimer = nil
        lock.unlock()
    }

    /// 외부 트리거(종료·시작·포그라운드·네트워크 복귀). 백오프 대기 중이어도 즉시 한 번 시도한다.
    public func kick() { attempt(external: true) }

    private func armPeriod() {
        lock.lock(); defer { lock.unlock() }
        periodTimer?.cancel()
        periodTimer = scheduler.schedule(after: Self.period) { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); let s = self.stopped; self.lock.unlock()
            if s { return }
            self.armPeriod()
            self.attempt(external: false)
        }
    }

    private func attempt(external: Bool) {
        lock.lock()
        if stopped || inFlight { lock.unlock(); return }
        if !external && retryTimer != nil { lock.unlock(); return }      // 주기 tick 은 백오프를 우회하지 않는다
        let batch = outbox.restBatch(max: isolate ? 1 : Self.batchSize)
        if batch.isEmpty { lock.unlock(); onIdle?(); return }
        retryTimer?.cancel(); retryTimer = nil; drainTimer?.cancel(); drainTimer = nil
        inFlight = true
        let force = forceRefresh
        lock.unlock()
        token(force) { [weak self] tk in
            guard let self = self else { return }
            guard let tk = tk else { self.failed(code: "no_token", forceRefresh: true); return }
            self.send(batch, tk)
        }
    }

    private func send(_ batch: [[String: Any]], _ tk: String) {
        var r = URLRequest(url: apiBase.appendingPathComponent("sessions").appendingPathComponent(sessionId).appendingPathComponent("features").appendingPathComponent("batch"))
        r.httpMethod = "POST"; r.timeoutInterval = 20
        r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue("Bearer \(tk)", forHTTPHeaderField: "Authorization")
        r.setValue("capacitor", forHTTPHeaderField: "X-MB-Native")
        var body: [String: Any] = ["windows": batch]
        if let p = participantId { body["participant_id"] = p }
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        http.send(r) { [weak self] res in
            guard let self = self else { return }
            switch res {
            case .failure: self.failed(code: "network", forceRefresh: false)
            case .success(let (status, data, _)): self.handle(status: status, data: data, batch: batch)
            }
        }
    }

    private func handle(status: Int, data: Data, batch: [[String: Any]]) {
        if status / 100 == 2 {
            guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let results = o["results"] as? [[String: Any]] else {
                failed(code: "bad_response", forceRefresh: false); return
            }
            var ok: [UInt64] = [], retry = false
            for res in results {
                guard let s = (res["sequence"] as? String).flatMap({ UInt64($0) }) else { continue }
                switch res["status"] as? String {
                case "accepted", "duplicate": ok.append(s)
                case "rejected":
                    let code = (res["code"] as? String) ?? "rejected"
                    if Self.quarantineCodes.contains(code) { outbox.markRejected([s], code: code) } else { retry = true; lastFailureCode = code }
                default: retry = true
                }
            }
            // 응답에 없는 창이 있으면(개수 불일치) pending 으로 남아 다음 시도에서 다시 간다.
            if results.count != batch.count { retry = true }
            outbox.markAcked(ok)
            lock.lock(); failures = retry ? failures : 0; forceRefresh = false; if isolate && !ok.isEmpty { isolate = false }; lock.unlock()
            onChange?()
            if retry { scheduleRetry() } else { scheduleDrain() }
            return
        }
        if status == 401 { failed(code: "http_401", forceRefresh: true); return }
        if status == 422 {
            if batch.count == 1, let s = (batch[0]["sequence"] as? String).flatMap({ UInt64($0) }) {
                outbox.markRejected([s], code: "invalid_message")
                lock.lock(); isolate = false; lock.unlock()
                onChange?(); scheduleDrain()
            } else {
                lock.lock(); isolate = true; lock.unlock()
                scheduleDrain()
            }
            return
        }
        failed(code: "http_\(status)", forceRefresh: false)      // 403/404/408/429/5xx 등 — 영구 실패로 단정하지 않고 느리게 재시도
    }

    private func scheduleDrain() {
        lock.lock(); defer { lock.unlock() }
        inFlight = false
        if stopped { return }
        drainTimer?.cancel()
        drainTimer = scheduler.schedule(after: Self.drainDelay) { [weak self] in self?.attempt(external: true) }
    }

    private func failed(code: String, forceRefresh force: Bool) {
        lock.lock(); lastFailureCode = code; if force { forceRefresh = true }; lock.unlock()
        onChange?()
        scheduleRetry()
    }

    private func scheduleRetry() {
        lock.lock(); defer { lock.unlock() }
        inFlight = false
        if stopped { return }
        let cap = min(Self.maxBackoff, pow(2, Double(min(failures, 20))))
        failures += 1
        retryTimer?.cancel()
        retryTimer = scheduler.schedule(after: max(Self.minRetryDelay, jitter(cap))) { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); self.retryTimer = nil; self.lock.unlock()
            self.attempt(external: true)
        }
    }
}
