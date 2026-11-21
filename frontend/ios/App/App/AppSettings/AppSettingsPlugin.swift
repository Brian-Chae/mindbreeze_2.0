import Foundation
import UIKit
import Capacitor

/// SDD-330: iOS 설정 앱의 이 앱 화면(블루투스·알림 등 권한)을 바로 연다.
@objc(AppSettingsPlugin)
public class AppSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppSettingsPlugin"
    public let jsName = "AppSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise),
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
}
