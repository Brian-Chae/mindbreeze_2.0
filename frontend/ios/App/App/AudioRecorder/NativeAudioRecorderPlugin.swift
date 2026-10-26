import Foundation
import UIKit
import AVFoundation
import Capacitor
import AudioRecorderKit

/// Capacitor 플러그인 `NativeAudioRecorder` — frontend/src/lib/native-audio-recorder/types.ts 계약.
/// 5초 AAC m4a 청크 → 디스크 큐 → 업로드(401 시 네이티브 refresh). 토큰 값은 이벤트·로그에 담지 않는다.
@objc(NativeAudioRecorderPlugin)
public class NativeAudioRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAudioRecorderPlugin"
    public let jsName = "NativeAudioRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMicEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateCredentials", returnType: CAPPluginReturnPromise),
    ]

    private static let chunkMs = 5000
    private let store: AudioCredentialStore = KeychainAudioCredentialStore()
    private let http: AudioHTTPClient = URLSessionAudioHTTPClient()
    private lazy var tokens = AudioTokenProvider(store: store, http: http)
    private lazy var queue: ChunkQueue = {
        var u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("audio-recorder", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        var v = URLResourceValues(); v.isExcludedFromBackup = true
        try? u.setResourceValues(v)
        return ChunkQueue(root: u)
    }()
    private lazy var uploader = ChunkUploader(queue: queue, tokens: tokens, http: http) { [weak self] e in self?.emit(e) }

    private var core: RecorderCore?
    private var engine: AudioCaptureEngine?
    private var lastStatus = RecorderStatus(state: .idle, sessionId: nil, nextChunkIndex: 0, uploadedCount: 0, pendingCount: 0, lastUploadedIndex: -1)

    // MARK: 생명주기

    override public func load() {
        // 앱 재실행: 이전 실행의 잔여 큐가 있으면 이어서 업로드한다(녹음 자동 재개는 하지 않음).
        guard let st = queue.loadState() else { return }
        guard !queue.pending().isEmpty else { queue.clearState(); return }
        emit(.stateChanged(sessionId: st.sessionId, state: .stopped, reason: .appRestart))
        Task { [uploader] in await uploader.drain() }
    }

    // MARK: 메서드

    @objc func isAvailable(_ call: CAPPluginCall) {
        let ok = AVAudioSession.sharedInstance().isInputAvailable
        call.resolve(ok ? ["available": true] : ["available": false, "reason": "no_input"])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let sid = call.getString("sessionId"), let base = call.getString("apiBase"),
              let at = call.getString("accessToken"), let rt = call.getString("refreshToken") else {
            call.reject("invalid_argument"); return
        }
        let startIndex = call.getInt("startChunkIndex") ?? 0
        guard core == nil else { call.reject("already_recording"); return }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .denied: call.reject("permission_denied", "permission_denied"); return
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.begin(call, sid, base, at, rt, startIndex) } else { call.reject("permission_denied", "permission_denied") }
                }
            }
        default: begin(call, sid, base, at, rt, startIndex)
        }
    }

    private func begin(_ call: CAPPluginCall, _ sid: String, _ base: String, _ at: String, _ rt: String, _ startIndex: Int) {
        store.save(AudioCredential(accessToken: at, refreshToken: rt, apiBase: base))
        uploader.resetCounters()
        let chunkSamples = Int(AudioCaptureEngine.sampleRate) * Self.chunkMs / 1000
        let c = RecorderCore(sessionId: sid, apiBase: base, startIndex: startIndex, queue: queue, uploader: uploader,
                             sampleRate: AudioCaptureEngine.sampleRate, chunkSamples: chunkSamples) { [weak self] e in self?.emit(e) }
        let e = AudioCaptureEngine()
        e.onSamples = { [weak c] s in c?.feed(s) }
        e.onInput = { [weak c] i in c?.apply(i) }
        e.onFailure = { [weak self] m in self?.emit(.error(sessionId: sid, code: .audioEngineFailed, message: m, recoverable: true)) }
        do { try e.start() } catch {
            call.reject("audio_engine_failed", "audio_engine_failed"); return
        }
        core = c; engine = e
        c.begin()
        call.resolve(statusJSON())
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let c = core else {
            call.resolve(["pendingCount": 0, "uploadedCount": 0, "lastChunkIndex": -1]); return
        }
        engine?.stop(); engine = nil
        var bg = UIBackgroundTaskIdentifier.invalid
        bg = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(bg) }
        Task { [weak self] in
            let r = await c.stop(timeout: 10)
            self?.core = nil
            self?.lastStatus = c.status()
            if bg != .invalid { UIApplication.shared.endBackgroundTask(bg) }
            // 남은 큐는 계속 전송한다.
            if r.pendingCount > 0, let up = self?.uploader { Task { await up.drain() } }
            call.resolve(["pendingCount": r.pendingCount, "uploadedCount": r.uploadedCount, "lastChunkIndex": r.lastChunkIndex])
        }
    }

    @objc func pause(_ call: CAPPluginCall) { core?.apply(.pause); call.resolve(statusJSON()) }
    @objc func resume(_ call: CAPPluginCall) {
        engine?.restartIfNeeded()
        core?.apply(.resume); call.resolve(statusJSON())
    }
    @objc func setMicEnabled(_ call: CAPPluginCall) {
        guard let en = call.getBool("enabled") else { call.reject("invalid_argument"); return }
        core?.apply(.micEnabled(en)); call.resolve(statusJSON())
    }
    @objc func getStatus(_ call: CAPPluginCall) { call.resolve(statusJSON()) }

    @objc func updateCredentials(_ call: CAPPluginCall) {
        guard let at = call.getString("accessToken"), let rt = call.getString("refreshToken") else { call.reject("invalid_argument"); return }
        store.update(access: at, refresh: rt)
        // auth_expired 로 멈췄던 업로드를 재개
        Task { [uploader] in await uploader.drain() }
        call.resolve()
    }

    // MARK: 이벤트·상태

    private func statusJSON() -> [String: Any] {
        let s = core?.status() ?? lastStatus
        return [
            "state": s.state.rawValue,
            "sessionId": s.sessionId as Any? ?? NSNull(),
            "nextChunkIndex": s.nextChunkIndex,
            "uploadedCount": s.uploadedCount,
            "pendingCount": s.pendingCount,
            "lastUploadedIndex": s.lastUploadedIndex,
        ]
    }

    private func emit(_ e: RecorderEvent) {
        switch e {
        case let .chunkUploaded(sid, idx, size, up, pend):
            notifyListeners("chunkUploaded", data: ["event": "chunkUploaded", "sessionId": sid, "chunkIndex": idx, "sizeBytes": size, "uploadedCount": up, "pendingCount": pend])
        case let .stateChanged(sid, st, reason):
            var d: [String: Any] = ["event": "stateChanged", "sessionId": sid as Any? ?? NSNull(), "state": st.rawValue]
            if let r = reason { d["reason"] = r.rawValue }
            notifyListeners("stateChanged", data: d)
        case let .error(sid, code, msg, rec):
            notifyListeners("error", data: ["event": "error", "sessionId": sid as Any? ?? NSNull(), "code": code.rawValue, "message": msg, "recoverable": rec])
        }
    }
}
