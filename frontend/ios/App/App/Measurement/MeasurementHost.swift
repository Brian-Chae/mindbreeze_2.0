import Foundation
import UIKit
import CoreBluetooth
import Network
import MeasurementKit

/// 앱 프로세스 수명 동안 하나만 존재하는 측정 호스트. AppDelegate.didFinishLaunching 에서 WebView 보다 먼저 `bootstrap()` 한다.
/// 기능 플래그(`mb.native_measurement.enabled`) 기본 off → off 이면 CBCentralManager 도 만들지 않아 BLE 권한 팝업·동작 변화가 전혀 없다.
public final class MeasurementHost {
    public static let shared = MeasurementHost()

    /// BLE 콜백·Socket.IO·LiveSession·Manager 를 한 직렬 큐에서 처리한다(JS 타이머 의존 없음).
    public let queue = DispatchQueue(label: "com.looxidlabs.mindbreeze2.measurement", qos: .userInitiated)
    public let ownership = BandOwnership()
    public private(set) var manager: MeasurementManager?
    public private(set) var band: BandLink?
    public var onBridgeEvent: (([String: Any]) -> Void)?

    private let store: CredentialStore = KeychainCredentialStore()
    private let http: HTTPClient = URLSessionHTTPClient()
    private let uploader = BackgroundFileUploader()
    private var uploaders: [String: ArchiveUploader] = [:]     // sessionId → uploader
    private var tokenProviders: [String: TokenProvider] = [:]
    private var bootstrapped = false
    private let root: URL = {
        var u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("measurement", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        var v = URLResourceValues(); v.isExcludedFromBackup = true        // OS 백업 제외
        try? u.setResourceValues(v)
        return u
    }()

    private init() {}

    /// 앱 시작 직후(WebView 이전). 플래그 off 이면 아무것도 하지 않는다.
    public func bootstrap() {
        guard !bootstrapped else { return }
        bootstrapped = true
        guard ownership.nativeEnabled else { return }
        queue.async { [self] in
            // SDD-301: manager/BandLink 는 하나만. 이미 있으면 CBCentralManager 를 또 만들지 않는다.
            guard ManagerBootstrapPolicy.shouldCreate(nativeEnabled: ownership.nativeEnabled, hasManager: manager != nil) else { return }
            let link = BandLink(queue: queue, expectedPeripheral: nil)
            band = link
            let m = MeasurementManager(
                root: root, band: link, ownership: ownership,
                makeLive: { [unowned self] sid in self.makeLive(sessionId: sid) },
                makeEngine: { dir, ctx, pin in try MeasurementEngine(dir: dir, configJSON: ModelPin.configJSON(pin), context: ctx, modelParamsJSON: pin?.paramsJSON) },
                scheduler: DispatchScheduler(queue: queue))
            m.onBridgeEvent = { [weak self] e in self?.onBridgeEvent?(e) }
            // 사용자 정지·회차 종료(live:terminal)·stream ended 모두 봉인 직후 저장 완결(마지막 배치·원시·대조)을 시작한다.
            m.onSealed = { [weak self] sid, handle in self?.sessionSealed(sessionId: sid, handle: handle) }
            m.onSessionReady = { [weak self] sid, handle, pid in self?.sessionReady(sessionId: sid, handle: handle, participantId: pid) }
            manager = m
            uploader.onCompleted = { [weak self] task, status, err in self?.queue.async { self?.uploaderFor(task: task)?.uploadCompleted(taskId: task, status: status, error: err) } }
            _ = m.recoverOnLaunch()
            drainPendingArchives()
            startPathMonitor()
        }
    }

    /// 플래그를 켠 직후(현재 실행 중)에도 manager 를 만들 수 있게 한다.
    public func ensureManager() {
        // SDD-301: 이미 만들어졌으면 아무것도 하지 않는다(예전엔 매 호출마다 bootstrapped=false 로 되돌려 BandLink 가 중복 생성됐다).
        let needs = queue.sync { ManagerBootstrapPolicy.shouldCreate(nativeEnabled: ownership.nativeEnabled, hasManager: manager != nil) }
        guard needs else { return }
        bootstrapped = false
        bootstrap()
        queue.sync {}
    }

    // MARK: 자격·live

    @discardableResult
    public func registerCredential(accountId: String, accessToken: String, refreshToken: String, apiBase: String) throws -> String {
        try store.save(Credential(accountId: accountId, accessToken: accessToken, refreshToken: refreshToken, apiBase: apiBase))
    }
    public func wipeCredential(accountId: String) { store.wipe(accountId: accountId) }

    private(set) var currentHandle: String?
    func setHandle(_ h: String) { currentHandle = h }

    private func provider(for handle: String) -> TokenProvider? {
        guard let c = try? store.load(handle: handle), let base = URL(string: c.apiBase) else { return nil }
        if let p = tokenProviders[handle] { return p }
        let p = TokenProvider(store: store, http: http, apiBase: base); tokenProviders[handle] = p; return p
    }

    private func makeLive(sessionId: String) -> LiveControlling {
        let handle = currentHandle ?? ""
        let cred = try? store.load(handle: handle)
        let base = URL(string: (cred?.apiBase ?? "").replacingOccurrences(of: "/api/v1", with: "")) ?? URL(string: "https://invalid.local")!
        let sch = DispatchScheduler(queue: queue)
        let client = SocketIOClient(baseURL: base, namespace: "/session-live", scheduler: sch,
                                    auth: { [store] in ["token": (try? store.load(handle: handle))??.accessToken ?? ""] },
                                    transportFactory: { [queue] in URLSessionWebSocketTransport(queue: queue) })
        let instance = (UserDefaults.standard.string(forKey: "mb.native_measurement.instance") ?? { let v = UUID().uuidString.lowercased(); UserDefaults.standard.set(v, forKey: "mb.native_measurement.instance"); return v }())
        let build = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "0"
        return LiveSession(client: client, scheduler: sch, sessionId: sessionId, instanceId: instance, appBuild: build, coreVersion: MeasurementManager.coreVersion) { [weak self] done in
            guard let p = self?.provider(for: handle) else { done(.failure(TokenRefreshError.invalid)); return }
            p.accessToken(handle: handle, forceRefresh: true) { r in self?.queue.async { done(r.mapError { $0 }) } }
        }
    }

    // MARK: 저장 완결 (SDD-260) — feature REST 정본 + 원시 archive + 종료 후 대조. 세션 단위 SessionSync 가 소유한다.

    private var syncs: [String: SessionSync] = [:]                 // sessionId → 오케스트레이터(호스트 큐에서만 접근)
    private var diskHandles: [String: (outbox: MetricOutbox, queue: ArchiveQueue)] = [:]   // 수집 중이 아닌 세션을 디스크에서 연 인스턴스(세션당 1개)
    private let pathMonitor = NWPathMonitor()
    private var lastPathSatisfied = false

    private func accountId(of handle: String?) -> String? { handle.flatMap { try? store.load(handle: $0) }.map { $0.accountId } }

    /// 세션 scope 를 보장한다(없으면 현재 계정으로 기록). 이미 있으면 그대로(원 소유 계정 유지).
    private func ensureScope(sessionId: String, handle: String?, participantId: String?) -> SessionScope? {
        let dir = sessionDir(sessionId)
        if let sc = SessionScope.load(dir: dir) { return sc }
        guard let acct = accountId(of: handle) else { return nil }
        let sc = SessionScope(sessionId: sessionId, accountId: acct, participantId: participantId)
        sc.save(dir: dir); return sc
    }

    private func sessionDir(_ sid: String) -> URL { root.appendingPathComponent("sessions").appendingPathComponent(sid) }

    /// 세션의 SessionSync 를 만들거나 기존 것을 돌려준다. 수집 중 세션은 manager 의 outbox/queue 인스턴스를 공유하고, 아니면 디스크에서 세션당 한 번만 연다.
    private func sync(for scope: SessionScope, handleHint: String?) -> SessionSync? {
        if let s = syncs[scope.sessionId] { return s }
        // 재로그인으로 handle 이 바뀌어도 계정으로 현재 handle 을 찾는다. 계정 자격이 없으면(로그아웃) 만들지 않고 보존만 한다.
        guard let handle = store.handle(forAccount: scope.accountId) ?? (accountId(of: handleHint) == scope.accountId ? handleHint : nil),
              let p = provider(for: handle), let c = try? store.load(handle: handle), c.accountId == scope.accountId, let base = URL(string: c.apiBase) else { return nil }
        let dir = sessionDir(scope.sessionId)
        let outbox: MetricOutbox, aq: ArchiveQueue
        if let o = manager?.outbox(forSession: scope.sessionId), let q = manager?.archiveQueue(forSession: scope.sessionId) { outbox = o; aq = q }
        else if let h = diskHandles[scope.sessionId] { outbox = h.outbox; aq = h.queue }
        else {
            guard let o = try? MetricOutbox(dir: dir), let q = try? ArchiveQueue(dir: dir.appendingPathComponent("archive")) else { return nil }
            diskHandles[scope.sessionId] = (o, q); outbox = o; aq = q
        }
        let sch = DispatchScheduler(queue: self.queue)
        let s = SessionSync(scope: scope, dir: dir, outbox: outbox, queue: aq, http: http, files: uploader, scheduler: sch, apiBase: base,
                            token: { force, done in p.accessToken(handle: handle, forceRefresh: force) { r in done(try? r.get()) } },
                            nowMs: { Int(Date().timeIntervalSince1970 * 1000) })
        let sid = scope.sessionId
        s.onProgress = { [weak self] snap in self?.queue.async { self?.manager?.archiveProgressed(); self?.manager?.emitSyncStatus(sessionId: sid, snap) } }
        s.onComplete = { [weak self] in self?.queue.async { self?.syncs[sid] = nil; self?.diskHandles[sid] = nil } }
        syncs[sid] = s
        return s
    }

    /// stream 확정(신규 채택·앱 재시작 복구) → 이 세션의 REST 저장 업로더를 켠다. 소켓/READY 와 무관하게 동작한다.
    private func sessionReady(sessionId: String, handle: String?, participantId: String) {
        queue.async { [self] in
            guard let sc = ensureScope(sessionId: sessionId, handle: handle ?? currentHandle, participantId: participantId),
                  let s = sync(for: sc, handleHint: handle ?? currentHandle) else { return }
            uploader.whenReady { [weak self] in self?.queue.async { s.start() } }
        }
    }

    /// 봉인(사용자 정지·회차 종료·terminal) → 마지막 배치 즉시 + 원시 업로드 지터 시작 + 종료 후 대조.
    private func sessionSealed(sessionId: String, handle: String?) {
        queue.async { [self] in
            guard let sc = ensureScope(sessionId: sessionId, handle: handle ?? currentHandle, participantId: nil),
                  let s = sync(for: sc, handleHint: handle ?? currentHandle) else { return }
            uploader.whenReady { [weak self] in self?.queue.async { s.sealed() } }
        }
    }

    /// 앱 시작·포그라운드·네트워크 복귀 — 디스크의 미완료 전 세션(SEALING/CLOSED/DRAINING 포함)을 이어서 전송한다. CAPTURING 복구와 별개.
    /// 다른 계정 scope 는 보존만 하고 건드리지 않는다(해당 계정 자격이 Keychain 에 없으면 sync 가 만들어지지 않는다).
    public func drainPendingArchives() {
        queue.async { [self] in
            guard let m = manager else { return }
            uploader.whenReady { [weak self] in
                self?.queue.async {
                    guard let self = self else { return }
                    for s in self.syncs.values { s.kick() }
                    for p in m.drainPendingArchives() {
                        guard let s = self.sync(for: p.scope, handleHint: nil) else { continue }
                        // OS 에 살아 있는 task 가 없는 uploading 항목은 pending 으로 되돌린다(앱 재시작 후 영구 정체 방지).
                        if let q = self.diskHandles[p.scope.sessionId]?.queue { try? q.releaseOrphans(liveTaskIds: self.uploader.liveTaskIds()) }
                        s.kick()
                    }
                }
            }
        }
    }

    private func startPathMonitor() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }
            let ok = path.status == .satisfied
            self.queue.async {
                let wasOk = self.lastPathSatisfied; self.lastPathSatisfied = ok
                if ok && !wasOk { self.drainPendingArchives() }      // 네트워크 복귀
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.looxidlabs.mindbreeze2.measurement.path"))
    }

    private func uploaderFor(task: Int) -> ArchiveUploader? { syncs.values.map { $0.archive }.first { $0.owns(task: task) } }

    public func handleBackgroundSession(identifier: String, completion: @escaping () -> Void) -> Bool {
        guard identifier == BackgroundFileUploader.sessionIdentifier else { return false }
        uploader.backgroundCompletionHandler = completion
        return true
    }

    // MARK: 시스템 상태

    public func capabilities() -> [String: Any] {
        let bt: String = { switch CBCentralManager.authorization { case .allowedAlways: return "granted"; case .notDetermined: return "not_determined"; default: return "denied" } }()
        return NativeCapabilities.make(osVersion: UIDevice.current.systemVersion, bluetooth: bt, notifications: "not_determined")
    }
}

extension ArchiveUploader {
    /// 이 업로더의 큐에 속한 task 인지.
    func owns(task: Int) -> Bool { queueRef.item(forTask: task) != nil }
}
