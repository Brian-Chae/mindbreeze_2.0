import UIKit
import AVFoundation
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 자격증명이 없는 로컬 셸에서도 BLE와 웹 화면을 사용할 수 있다.
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            Messaging.messaging().delegate = self
        }
        // SDD-246 T07: 측정 매니저는 WebView(CAPBridgeViewController) 로드 전에 복구한다. 플래그 기본 off → off 면 아무 동작도 하지 않는다.
        MeasurementHost.shared.bootstrap()
        configureAudioSession()
        return true
    }

    // 화면 잠금·앱 전환 중에도 수업 음성과 프로세스가 유지되도록 playback 카테고리를 사용한다(SDD-222).
    // mixWithOthers 는 실기기 확인 후 결정하므로 기본 미사용. 실패해도 앱 시작을 막지 않는다.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            NSLog("[SDD-222] AVAudioSession 설정 실패: \(error.localizedDescription)")
        }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard FirebaseApp.app() != nil else { return }
        // 서버는 FCM만 사용하므로 APNs 토큰을 JS로 직접 전달하지 않는다.
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { token, error in
            if let error = error {
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            } else if let token = token {
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            }
        }
    }

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        // APNs 연결 이후 갱신되는 FCM 토큰도 기존 등록 이벤트로 전달한다.
        guard messaging.apnsToken != nil, let token = fcmToken else { return }
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // SDD-246 T07: archive 전용 background URLSession 이 앱을 깨웠을 때 완료 handler 를 연결한다.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        MeasurementHost.shared.bootstrap()
        if !MeasurementHost.shared.handleBackgroundSession(identifier: identifier, completion: completionHandler) { completionHandler() }
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
