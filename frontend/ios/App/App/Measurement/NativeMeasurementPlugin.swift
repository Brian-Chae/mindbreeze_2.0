import Foundation
import UIKit
import Capacitor
import MeasurementKit

/// Capacitor 플러그인 `NativeMeasurement` — contracts/measurement-bridge 와 Android 와 같은 API.
/// WebView 는 제어·조회만 한다(수집·journal·소켓·업로드는 MeasurementHost 소유). raw 전량은 브리지로 보내지 않고, 이벤트는 foreground 에만 batch 한다.
@objc(NativeMeasurementPlugin)
public class NativeMeasurementPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeMeasurementPlugin"
    public let jsName = "NativeMeasurement"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startMeasurement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMeasurementSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRawPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dispatchLiveCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopMeasurement", returnType: CAPPluginReturnPromise),
        // 계약 외 확장(T01 에 반영 요청): 기능 플래그 / 계정 scope 자격 인계
        CAPPluginMethod(name: "setNativeOwnership", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setJSBandOwnership", returnType: CAPPluginReturnPromise),
    ]

    private var observers: [NSObjectProtocol] = []
    private var lastEmit: [String: TimeInterval] = [:]
    private let host = MeasurementHost.shared

    override public func load() {
        host.onBridgeEvent = { [weak self] e in self?.forward(e) }
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in self?.setVisibility(.foreground) })
        observers.append(nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in self?.setVisibility(.background) })
        observers.append(nc.addObserver(forName: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil, queue: nil) { [weak self] _ in self?.setVisibility(.locked) })
        observers.append(nc.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: nil) { [weak self] _ in self?.setVisibility(UIApplication.shared.applicationState == .active ? .foreground : .background) })
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    private func setVisibility(_ v: Visibility) { host.queue.async { [host] in host.manager?.setVisibility(v) } }

    /// foreground 일 때만, measurementUpdated 는 초당 1회로 합쳐 보낸다. 백그라운드에서는 보내지 않는다(복귀 시 getMeasurementSnapshot).
    private func forward(_ e: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, UIApplication.shared.applicationState == .active, let name = e["event"] as? String else { return }
            if name == "measurementUpdated" {
                let now = Date().timeIntervalSince1970
                if now - (self.lastEmit[name] ?? 0) < 1 { return }
                self.lastEmit[name] = now
            }
            self.notifyListeners(name, data: e)
        }
    }

    private func fail(_ call: CAPPluginCall, _ e: Error) {
        if let m = e as? ManagerError {
            switch m {
            case .nativeDisabled: call.reject("native_ownership_disabled", "native_ownership_disabled")
            case .jsOwnsBand: call.reject("js_owns_band", "js_owns_band")
            case .alreadyActive: call.reject("already_active", "already_active")
            case .notActive: call.reject("not_active", "not_active")
            case .invalidArgument(let a): call.reject("invalid_argument", a)
            }
        } else { call.reject("internal_error", String(describing: type(of: e))) }   // 오류 본문에 값(토큰 등)을 싣지 않는다
    }

    @objc func getCapabilities(_ call: CAPPluginCall) { call.resolve(host.capabilities()) }

    @objc func setNativeOwnership(_ call: CAPPluginCall) {
        host.ownership.nativeEnabled = call.getBool("enabled") ?? false
        if host.ownership.nativeEnabled { host.ensureManager() }
        call.resolve(["enabled": host.ownership.nativeEnabled])
    }

    @objc func setJSBandOwnership(_ call: CAPPluginCall) {
        let ok = host.ownership.setJSOwning(call.getBool("owning") ?? false)
        call.resolve(["accepted": ok])
    }

    @objc func registerCredential(_ call: CAPPluginCall) {
        // 요청에는 토큰이 들어온다(웹→native 1회 인계, 계약 허용). 결과로는 불투명 핸들만 — 토큰을 되돌리면 계약 위반.
        guard let req = NativeBridgeAPI.parseRegisterCredential(call.options as? [String: Any] ?? [:]) else {
            call.reject("invalid_argument", "credential"); return
        }
        do {
            let h = try host.registerCredential(accountId: req.accountId, accessToken: req.accessToken, refreshToken: req.refreshToken, apiBase: req.apiBase)
            host.setHandle(h); call.resolve(NativeBridgeAPI.registerCredentialResult(handle: h))
        } catch { call.reject("credential_store_failed") }
    }

    @objc func startMeasurement(_ call: CAPPluginCall) {
        guard let sid = call.getString("sessionId"), let h = call.getString("credentialHandle"), let cfg = call.getString("configHash"), let rid = call.getString("requestId") else {
            call.reject("invalid_argument", "start"); return
        }
        let pid = call.getString("peripheralId")   // 선택(하위호환): 웹뷰 BLE 로 고른 장치 UUID
        let modelParams = call.getString("modelParams"), modelVersion = call.getString("modelVersion")   // 활성 표준 모델(비밀 아님). 없으면 코호트
        host.ensureManager()
        host.setHandle(h)
        host.queue.async { [host, weak self] in
            guard let m = host.manager else { call.reject("native_ownership_disabled", "native_ownership_disabled"); return }
            do { call.resolve(try m.startMeasurement(sessionId: sid, credentialHandle: h, configHash: cfg, requestId: rid, peripheralId: pid, modelParams: modelParams, modelVersion: modelVersion)) } catch { self?.fail(call, error) }
        }
    }

    @objc func getMeasurementSnapshot(_ call: CAPPluginCall) {
        host.queue.async { [host] in
            guard let m = host.manager else { call.reject("not_active", "not_active"); return }
            call.resolve(m.snapshot())
        }
    }

    /// 기기 시트 원시 파형 미리보기(시트가 열려 있을 때만 JS 가 1초 폴링). 결과는 숫자 배열뿐 — 토큰·원문 바이트 없음. 측정 중이 아니면 빈 배열.
    @objc func getRawPreview(_ call: CAPPluginCall) {
        let points = min(max(call.getInt("points") ?? 120, 2), 500)
        host.queue.async { [host] in
            call.resolve(host.manager?.rawPreview(points: points) ?? ["eegFp1": [Double](), "eegFp2": [Double](), "ppgRed": [Double](), "ppgIr": [Double]()])
        }
    }

    @objc func dispatchLiveCommand(_ call: CAPPluginCall) {
        let cmd = call.options as? [String: Any] ?? [:]
        host.queue.async { [host, weak self] in
            guard let m = host.manager else { call.reject("not_active", "not_active"); return }
            do { call.resolve(try m.dispatchLiveCommand(cmd.filter { $0.key != "callbackId" })) } catch { self?.fail(call, error) }
        }
    }

    @objc func stopMeasurement(_ call: CAPPluginCall) {
        guard let reason = call.getString("reason"), let rid = call.getString("requestId") else { call.reject("invalid_argument", "stop"); return }
        host.queue.async { [host, weak self] in
            guard let m = host.manager else { call.reject("not_active", "not_active"); return }
            do {
                call.resolve(try m.stopMeasurement(reason: reason, requestId: rid))   // archive 시작은 manager.onSealed 가 한다
            } catch { self?.fail(call, error) }
        }
    }
}
