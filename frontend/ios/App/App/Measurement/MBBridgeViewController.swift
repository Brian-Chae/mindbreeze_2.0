import UIKit
import Capacitor

/// Main.storyboard 의 브리지 뷰컨트롤러. 앱 로컬 플러그인(NativeMeasurement)을 등록한다.
class MBBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeMeasurementPlugin())
    }
}
