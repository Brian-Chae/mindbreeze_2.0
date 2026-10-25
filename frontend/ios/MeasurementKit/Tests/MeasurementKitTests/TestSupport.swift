import Foundation
@testable import MeasurementKit

/// 수동 시계 — 타이머/백오프를 시간 경과 없이 구동한다.
final class ManualScheduler: Scheduler {
    private(set) var now: TimeInterval = 0
    private var items: [(id: Int, at: TimeInterval, block: () -> Void)] = []
    private var next = 0
    func schedule(after: TimeInterval, _ block: @escaping () -> Void) -> Cancellable {
        next += 1; let id = next
        items.append((id, now + after, block))
        return CancelToken { [weak self] in self?.items.removeAll { $0.id == id } }
    }
    func advance(_ dt: TimeInterval) {
        let target = now + dt
        while let i = items.indices.filter({ items[$0].at <= target }).min(by: { items[$0].at < items[$1].at }) {
            let it = items.remove(at: i); now = max(now, it.at); it.block()
        }
        now = target
    }
    var pendingCount: Int { items.count }
}

final class FakeTransport: WebSocketTransport {
    var onOpen: (() -> Void)?; var onText: ((String) -> Void)?; var onClose: ((String?) -> Void)?
    private(set) var sent: [String] = []; private(set) var connectedURL: URL?; private(set) var closed = false
    func connect(url: URL) { connectedURL = url }
    func send(_ text: String) { sent.append(text) }
    func close() { closed = true }
    // 서버 쪽 시뮬레이션
    func serverOpen(sid: String = "s1", pingInterval: Int = 25000, pingTimeout: Int = 20000) {
        onOpen?()
        onText?("0{\"sid\":\"\(sid)\",\"upgrades\":[],\"pingInterval\":\(pingInterval),\"pingTimeout\":\(pingTimeout),\"maxPayload\":1000000}")
    }
    func serverSend(_ t: String) { onText?(t) }
    func serverDrop(_ reason: String? = "transport close") { onClose?(reason) }
}

func projectRoot(file: String = #filePath) -> URL {
    var u = URL(fileURLWithPath: file)
    while u.path != "/" { u.deleteLastPathComponent(); if FileManager.default.fileExists(atPath: u.appendingPathComponent("contracts/biosignal-golden").path) { return u } }
    fatalError("repo root not found")
}
