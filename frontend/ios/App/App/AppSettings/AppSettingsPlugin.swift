import Foundation
import UIKit
import Capacitor
import CoreBluetooth

/// SDD-330: iOS 설정 앱의 이 앱 화면(블루투스·알림 등 권한)을 바로 연다.
@objc(AppSettingsPlugin)
public class AppSettingsPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate {
    public let identifier = "AppSettingsPlugin"
    public let jsName = "AppSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isBluetoothEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestEnableBluetooth", returnType: CAPPluginReturnPromise),
    ]

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("설정 주소를 만들 수 없어요")
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { call.resolve() } else { call.reject("설정 화면을 열지 못했어요") }
            }
        }
    }

    // MARK: SDD-333 블루투스 꺼짐 안내
    // 공개 API 로는 블루투스 설정 화면 딥링크가 없다(App-Prefs: 등 비공개 URL 은 심사 거절 위험 — 쓰지 않는다).
    // 대신 CBCentralManagerOptionShowPowerAlertKey 로 iOS 시스템 "Bluetooth 켜기" 알림(설정 버튼 포함)을 띄운다.

    private var powerManager: CBCentralManager?

    /// 블루투스가 켜져 있는지. 권한을 아직 묻지 않았거나 거부면 권한 창을 띄우지 않도록 null(알 수 없음)을 돌려준다.
    @objc func isBluetoothEnabled(_ call: CAPPluginCall) {
        guard CBCentralManager.authorization == .allowedAlways else {
            call.resolve(["enabled": NSNull()])
            return
        }
        DispatchQueue.main.async {
            let manager = self.powerManager ?? CBCentralManager(delegate: self, queue: .main, options: [CBCentralManagerOptionShowPowerAlertKey: false])
            self.powerManager = manager
            switch manager.state {
            case .poweredOn: call.resolve(["enabled": true])
            case .poweredOff: call.resolve(["enabled": false])
            default: call.resolve(["enabled": NSNull()])   // resetting/unknown — 다음 확인에서 정해진다
            }
        }
    }

    /// iOS 시스템 "Bluetooth 켜기" 알림을 띄운다. 이미 켜져 있으면 already_on. 알림은 OS 가 정책으로 제한(앱당 반복 노출 억제)하므로
    /// 호출부는 mode == "power_alert" 여도 안 켜지면 제어센터·설정 안내를 함께 보여야 한다.
    @objc func requestEnableBluetooth(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let manager = self.powerManager, manager.state == .poweredOn {
                call.resolve(["mode": "already_on"])
                return
            }
            // 알림 옵션은 매니저를 만들 때만 적용된다 — 새로 만들어 OS 가 꺼짐 상태를 확인하며 알림을 띄우게 한다.
            self.powerManager = CBCentralManager(delegate: self, queue: .main, options: [CBCentralManagerOptionShowPowerAlertKey: true])
            call.resolve(["mode": "power_alert"])
        }
    }

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {}
}
