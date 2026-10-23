# 진단 전용. 실행 전 git diff가 깨끗한지 확인하고, 종료 후 AppDelegate.swift를 git restore한다.
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[3])
p=Path('frontend/ios/App/App/AppDelegate.swift')
assert 'sdd236-command.json' not in p.read_text(), '진단 코드가 이미 주입되어 있습니다'
Path('/tmp/sdd236-appdelegate-original').write_text(p.read_text())
s=p.read_text().replace('import UIKit','import UIKit\nimport WebKit')
s=s.replace('        configureAudioSession()', '''        // 로컬 진단 전용. 커밋하지 않는다.
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let root = self?.window?.rootViewController else { return }
            func find(_ view: UIView) -> WKWebView? {
                if let web = view as? WKWebView { return web }
                for child in view.subviews { if let web = find(child) { return web } }
                return nil
            }
            guard let web = find(root.view), let scene = root.view.window?.windowScene else { return }
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let command = dir.appendingPathComponent("sdd236-command.json")
            if let data = try? Data(contentsOf: command),
               let cmd = try? JSONSerialization.jsonObject(with: data) as? [String: String],
               cmd["id"] != UserDefaults.standard.string(forKey: "sdd236-command") {
                UserDefaults.standard.set(cmd["id"], forKey: "sdd236-command")
                if let js = cmd["js"] { web.evaluateJavaScript(js) }
                if let orientation = cmd["orientation"], #available(iOS 16.0, *) {
                    root.setNeedsUpdateOfSupportedInterfaceOrientations()
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientation == "landscape" ? .landscapeRight : .portrait))
                }
            }
            let metrics: [String: Any] = [
                "frame": NSCoder.string(for: web.frame), "bounds": NSCoder.string(for: root.view.bounds),
                "safeTop": root.view.safeAreaInsets.top, "webSafeTop": web.safeAreaInsets.top,
                "statusHeight": scene.statusBarManager?.statusBarFrame.height ?? -1,
                "insetTop": web.scrollView.contentInset.top, "adjustedTop": web.scrollView.adjustedContentInset.top,
                "scale": scene.screen.scale
            ]
            web.evaluateJavaScript("JSON.stringify(window.sdd236Measure ? window.sdd236Measure() : {path:location.pathname,height:innerHeight})") { result, _ in
                var value = metrics
                if let json = result as? String, let data = json.data(using: .utf8) { value["dom"] = try? JSONSerialization.jsonObject(with: data) }
                if let data = try? JSONSerialization.data(withJSONObject: value, options: .prettyPrinted) {
                    try? data.write(to: dir.appendingPathComponent("sdd236-metrics.json"), options: .atomic)
                }
            }
        }
        configureAudioSession()''')
p.write_text(s)
