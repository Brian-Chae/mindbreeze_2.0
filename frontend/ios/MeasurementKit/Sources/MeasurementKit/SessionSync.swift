import Foundation

/// 세션 디렉터리에 남기는 계정 scope. 다른 계정이 로그인해도 이 세션의 데이터를 보내지 않고(보존만) 원래 계정이 돌아오면 이어 보낸다.
public struct SessionScope: Equatable {
    public static let fileName = "scope.json"
    public let sessionId: String, accountId: String, participantId: String?
    public init(sessionId: String, accountId: String, participantId: String?) { self.sessionId = sessionId; self.accountId = accountId; self.participantId = participantId }

    public static func load(dir: URL) -> SessionScope? {
        guard let d = try? Data(contentsOf: dir.appendingPathComponent(fileName)), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let s = o["session_id"] as? String, let a = o["account_id"] as? String else { return nil }
        return SessionScope(sessionId: s, accountId: a, participantId: o["participant_id"] as? String)
    }
    public func save(dir: URL) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let o: [String: Any] = ["session_id": sessionId, "account_id": accountId, "participant_id": participantId as Any? ?? NSNull()]
        if let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]) { try? d.write(to: dir.appendingPathComponent(Self.fileName), options: .atomic) }
    }
}

/// 디스크에 남은 미완료 세션 한 건(SEALING/CLOSED/DRAINING 포함 — active.json 상태와 무관하게 디렉터리 기준).
public struct PendingSession {
    public let scope: SessionScope
    public let dir: URL
}

public enum SessionDrain {
    /// 세션 디렉터리가 아직 할 일이 남았는지: feature/원시 완료 마커 부재 · outbox 대기 · archive 대기 · 종료 기록 미전송.
    /// 마커가 없다고 항상 일이 있는 것은 아니다(비어 있던 세션은 대조 없이 완료 마커가 즉시 생긴다) — 그래서 호출자가 SessionSync 를 돌려 마커를 만든다.
    static func needsWork(dir: URL) -> Bool {
        let fm = FileManager.default
        func has(_ n: String) -> Bool { fm.fileExists(atPath: dir.appendingPathComponent(n).path) }
        if !has(FeatureReconciler.markerName) || !has(RawReconciler.markerName) { return true }
        if CloseIntentStore(file: dir.appendingPathComponent(CloseIntentStore.fileName)).pending() != nil { return true }
        return false
    }

    /// root/sessions/* 중 scope.json 이 있고 할 일이 남은 세션. `excluding` 은 지금 수집 중이라 이미 SessionSync 가 돌고 있는 세션.
    public static func pending(root: URL, excluding: Set<String> = []) -> [PendingSession] {
        let base = root.appendingPathComponent("sessions")
        guard let dirs = try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil) else { return [] }
        return dirs.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { d in
            guard let sc = SessionScope.load(dir: d), !excluding.contains(sc.sessionId), needsWork(dir: d) else { return nil }
            return PendingSession(scope: sc, dir: d)
        }
    }
}

public struct SyncSnapshot: Equatable {
    public var featurePending = 0, featureAcked = 0, featureRejected = 0
    public var archivePending = 0, archiveUploading = 0, archiveVerified = 0, archiveQuarantined = 0
    public var featureState = "syncing", rawState = "syncing"
    public var complete = false
    /// SDD-264: raw 청크 신호별 개수. nil = 아직 큐를 못 읽음(이벤트에 싣지 않는다).
    public var signals: [String: SignalCounts]? = nil
}

/// 세션 하나의 "저장 완결" 오케스트레이터 — FeatureUploader(REST 정본) · ArchiveUploader(원시) · 종료 후 summary 대조 · 종료 기록.
/// 앱 시작·포그라운드·네트워크 복귀·60초 주기(미완료일 때만)에 `kick()` 으로 깨우며, 화면(클래스 화면 진입 여부)과 무관하다.
/// 완료(두 대조 마커 + 종료 기록 전송) 전에는 로컬 파일을 지우지 않는다 — 이 클래스는 어떤 파일도 삭제하지 않는다.
public final class SessionSync {
    public static let tickSeconds: TimeInterval = 60
    public static let reconcileMinInterval: TimeInterval = 10

    public let scope: SessionScope
    private let dir: URL
    private let outbox: MetricOutbox, queue: ArchiveQueue
    private let scheduler: Scheduler
    public let features: FeatureUploader
    public let archive: ArchiveUploader
    private let featureRec: FeatureReconciler, rawRec: RawReconciler
    private let jitter: (Double) -> Double
    private let lock = NSRecursiveLock()
    private var stopped = true
    private var tickTimer: Cancellable?, archiveStartTimer: Cancellable?
    private var lastReconcile: TimeInterval = -1000
    private var snap = SyncSnapshot()
    public var onSnapshot: ((SyncSnapshot) -> Void)?
    public var onComplete: (() -> Void)?
    /// 모든 진행 변화(큐·ACK·대조 상태) 뒤 — 호스트가 manager.archiveProgressed()·브리지 이벤트에 쓴다.
    public var onProgress: ((SyncSnapshot) -> Void)?

    /// - archiveStartJitter: 종료 직후 40기기가 동시에 presign 을 몰아치지 않도록 archive 첫 pump 를 0~60초 지연(상한 초).
    public init(scope: SessionScope, dir: URL, outbox: MetricOutbox, queue: ArchiveQueue, http: HTTPClient, files: FileUploading, scheduler: Scheduler,
                apiBase: URL, token: @escaping (Bool, @escaping (String?) -> Void) -> Void, nowMs: @escaping () -> Int,
                jitter: @escaping (Double) -> Double = { Double.random(in: 0...$0) }) {
        self.scope = scope; self.dir = dir; self.outbox = outbox; self.queue = queue; self.scheduler = scheduler; self.jitter = jitter
        let sid = scope.sessionId, pid = scope.participantId
        features = FeatureUploader(outbox: outbox, http: http, scheduler: scheduler, apiBase: apiBase, sessionId: sid, participantId: pid, token: token, jitter: jitter)
        archive = ArchiveUploader(queue: queue, http: http, files: files, apiBase: apiBase, sessionId: sid, participantId: pid,
                                  token: { done in token(false, done) }, fileURL: { dir.appendingPathComponent("archive").appendingPathComponent($0.file) }, nowMs: nowMs)
        archive.closeIntents = CloseIntentStore(file: dir.appendingPathComponent(CloseIntentStore.fileName))
        archive.scheduleRetry = { [weak scheduler] sec, work in _ = scheduler?.schedule(after: sec, work) }
        featureRec = FeatureReconciler(outbox: outbox, uploader: features, http: http, apiBase: apiBase, sessionId: sid, participantId: pid, token: token, markerDir: dir)
        rawRec = RawReconciler(queue: queue, http: http, apiBase: apiBase, sessionId: sid, participantId: pid, token: token, markerDir: dir)
        features.onIdle = { [weak self] in self?.reconcile() }
        features.onChange = { [weak self] in self?.publish() }
        archive.onChange = { [weak self] in self?.publish(); self?.reconcile() }
    }

    /// 봉인(final.json) 이후에만 서버 대조를 한다 — 수집 중에는 sequence 가 계속 늘어 "빈 배열"이 의미가 없다.
    public var isSealed: Bool { FileManager.default.fileExists(atPath: dir.appendingPathComponent("final.json").path) }
    public var isComplete: Bool {
        featureRec.isComplete && rawRec.isComplete && CloseIntentStore(file: dir.appendingPathComponent(CloseIntentStore.fileName)).pending() == nil
    }
    public var snapshot: SyncSnapshot { lock.lock(); defer { lock.unlock() }; return snap }

    public func start() {
        lock.lock(); stopped = false; lock.unlock()
        features.start()
        armTick()
        // 첫 archive pump 는 지터 후(이미 시작된 세션이 재개될 때도 동일 — 40기기 동시 재실행 완화)
        let delay = jitter(isSealed ? 60 : 0)
        archiveStartTimer?.cancel()
        archiveStartTimer = scheduler.schedule(after: delay) { [weak self] in self?.archive.pump(); self?.reconcile() }
        publish()
    }

    public func stop() {
        lock.lock(); stopped = true; tickTimer?.cancel(); tickTimer = nil; archiveStartTimer?.cancel(); archiveStartTimer = nil; lock.unlock()
        features.stop()
    }

    /// 봉인 직후(사용자 정지·회차 종료): feature 는 마지막 배치를 즉시 보내고, 원시 업로드는 0~60초 지터 후 시작한다(40기기 동시 종료 완화, N4).
    public func sealed() {
        lock.lock(); let s = stopped; lock.unlock()
        if s { start() }
        features.kick()
        archiveStartTimer?.cancel()
        archiveStartTimer = scheduler.schedule(after: jitter(60)) { [weak self] in self?.archive.pump(); self?.reconcile() }
        publish()
    }

    /// 포그라운드·네트워크 복귀·앱 시작 트리거. 백오프 중이어도 즉시 한 번 시도한다.
    public func kick() {
        lock.lock(); let s = stopped; lock.unlock()
        if s { start(); return }
        features.kick(); archive.pump(); lastReconcile = -1000; reconcile()
    }

    private func armTick() {
        lock.lock(); defer { lock.unlock() }
        tickTimer?.cancel()
        tickTimer = scheduler.schedule(after: Self.tickSeconds) { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); let s = self.stopped; self.lock.unlock()
            if s { return }
            if self.isComplete { return }       // 완료되면 주기 중단
            self.features.kick(); self.archive.pump(); self.reconcile()
            self.armTick()
        }
    }

    private func reconcile() {
        guard isSealed else { publish(); return }
        let now = scheduler.nowSeconds
        lock.lock()
        if now - lastReconcile < Self.reconcileMinInterval { lock.unlock(); publish(); return }
        lastReconcile = now
        lock.unlock()
        if !featureRec.isComplete {
            featureRec.run { [weak self] st in
                guard let self = self else { return }
                self.lock.lock()
                switch st {
                case .complete: self.snap.featureState = "complete"
                case .resending: self.snap.featureState = "resending"
                case .waiting: self.snap.featureState = "syncing"
                case .failed: self.snap.featureState = "retrying"
                }
                self.lock.unlock()
                if case .resending = st { self.features.kick() }
                self.publish()
            }
        } else { snap.featureState = "complete" }
        if !rawRec.isComplete {
            rawRec.run { [weak self] st in
                guard let self = self else { return }
                self.lock.lock()
                switch st {
                case .complete: self.snap.rawState = "complete"
                case .resending: self.snap.rawState = "resending"
                case .waiting: self.snap.rawState = "syncing"
                case .unverifiable: self.snap.rawState = "unverifiable"
                case .failed: self.snap.rawState = "retrying"
                }
                self.lock.unlock()
                if case .resending = st { self.archive.pump() }
                self.publish()
            }
        } else { snap.rawState = "complete" }
        publish()
    }

    private func publish() {
        let oc = outbox.counts(), ac = queue.counts
        lock.lock()
        snap.featurePending = oc.livePending; snap.featureAcked = oc.liveAcked; snap.featureRejected = oc.rejected
        snap.archivePending = ac.pending; snap.archiveUploading = ac.uploading; snap.archiveVerified = ac.verified; snap.archiveQuarantined = ac.quarantined
        snap.signals = queue.signalCounts()
        let wasComplete = snap.complete
        snap.complete = isSealed && isComplete
        let s = snap, justDone = snap.complete && !wasComplete
        lock.unlock()
        onSnapshot?(s); onProgress?(s)
        if justDone { stop(); onComplete?() }
    }
}
