import Foundation
import UIKit
import CoreBluetooth
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
            let link = BandLink(queue: queue, expectedPeripheral: nil)
            band = link
            let m = MeasurementManager(
                root: root, band: link, ownership: ownership,
                makeLive: { [unowned self] sid in self.makeLive(sessionId: sid) },
                makeEngine: { dir, ctx in try MeasurementEngine(dir: dir, configJSON: Self.coreConfig, context: ctx) },
                scheduler: DispatchScheduler(queue: queue))
            m.onBridgeEvent = { [weak self] e in self?.onBridgeEvent?(e) }
            // 사용자 정지·회차 종료(live:terminal)·stream ended 모두 봉인 직후 archive 업로드를 시작한다.
            m.onSealed = { [weak self] sid, handle in
                guard let self = self, let h = handle ?? self.currentHandle else { return }
                self.startArchive(sessionId: sid, participantId: nil, handle: h)
            }
            manager = m
            uploader.onCompleted = { [weak self] task, status, err in self?.queue.async { self?.uploaderFor(task: task)?.uploadCompleted(taskId: task, status: status, error: err) } }
            _ = m.recoverOnLaunch()
            resumeArchiveUploads()
        }
    }

    /// 플래그를 켠 직후(현재 실행 중)에도 manager 를 만들 수 있게 한다.
    public func ensureManager() {
        queue.sync { if manager == nil, ownership.nativeEnabled { bootstrapped = false } }
        bootstrapped = false
        bootstrap()
        queue.sync {}
    }

    static let coreConfig = """
    {"abi_version":1,"device_profile_version":"linkband2-v1","algorithm_version":"web-ts-1","model_version":"b0-cohort-2","model_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","model_mode":"legacy_cohort","rates_hz":{"eeg":250,"ppg":50,"acc":30},"anchor":"last_sample_web_v1","acc_interval_profile":"rounded_33333us_v1"}
    """

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

    // MARK: archive

    private func uploaderFor(task: Int) -> ArchiveUploader? { uploaders.values.first { $0.owns(task: task) } }

    /// 세션별 archive 업로더를 만들고(이미 있으면 재사용) 한 번 pump 한다.
    public func startArchive(sessionId: String, participantId: String?, handle: String) {
        queue.async { [self] in
            guard let m = manager, let q = m.archiveQueue, let p = provider(for: handle), let c = try? store.load(handle: handle), let base = URL(string: c.apiBase) else { return }
            let up = uploaders[sessionId] ?? ArchiveUploader(queue: q, http: http, files: uploader, apiBase: base, sessionId: sessionId, participantId: participantId,
                token: { done in p.accessToken(handle: handle) { r in done(try? r.get()) } },
                fileURL: { [unowned m] in m.archiveFileURL($0) }, nowMs: { Int(Date().timeIntervalSince1970 * 1000) })
            up.onChange = { [weak self, weak m] in m?.archiveProgressed(); m?.emitArchiveStatus(stage: nil, code: nil); self?.persistArchivePointer(sessionId: sessionId, participantId: participantId, handle: handle) }
            uploaders[sessionId] = up
            persistArchivePointer(sessionId: sessionId, participantId: participantId, handle: handle)
            up.pump()
        }
    }

    private var pointerDir: URL { root.appendingPathComponent("pending-archive", isDirectory: true) }
    private func persistArchivePointer(sessionId: String, participantId: String?, handle: String) {
        try? FileManager.default.createDirectory(at: pointerDir, withIntermediateDirectories: true)
        let f = pointerDir.appendingPathComponent("\(sessionId).json")
        guard let q = manager?.archiveQueue else { return }
        let c = q.counts
        if c.pending + c.uploading == 0 && c.pendingAuthorization == 0 && c.pendingTimeReview == 0 { try? FileManager.default.removeItem(at: f); return }
        let d: [String: Any] = ["sessionId": sessionId, "participantId": participantId ?? NSNull(), "handle": handle]
        try? JSONSerialization.data(withJSONObject: d).write(to: f, options: .atomic)
    }
    private func resumeArchiveUploads() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: pointerDir, includingPropertiesForKeys: nil) else { return }
        for f in files where f.pathExtension == "json" {
            guard let d = try? Data(contentsOf: f), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let sid = o["sessionId"] as? String, let h = o["handle"] as? String else { continue }
            startArchive(sessionId: sid, participantId: o["participantId"] as? String, handle: h)
        }
    }

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
