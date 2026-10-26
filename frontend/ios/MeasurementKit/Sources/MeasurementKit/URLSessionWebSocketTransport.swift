import Foundation

/// URLSessionWebSocketTask 기반 전송. 모든 콜백은 `queue`(직렬)에서 호출된다.
public final class URLSessionWebSocketTransport: NSObject, WebSocketTransport, URLSessionWebSocketDelegate {
    public var onOpen: (() -> Void)?
    public var onText: ((String) -> Void)?
    public var onClose: ((String?) -> Void)?
    private let queue: DispatchQueue
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var closedNotified = false

    public init(queue: DispatchQueue) {
        self.queue = queue
        super.init()
        let op = OperationQueue(); op.underlyingQueue = queue; op.maxConcurrentOperationCount = 1
        session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: op)
    }

    public func connect(url: URL) {
        closedNotified = false
        var req = URLRequest(url: url); req.timeoutInterval = 15
        task = session.webSocketTask(with: req)
        task?.maximumMessageSize = 2 * 1024 * 1024
        task?.resume()
        receive()
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(.string(let s)): self.onText?(s); self.receive()
            case .success(.data): self.receive()                  // wire 계약은 텍스트 JSON 뿐 — 바이너리 무시
            case .success: self.receive()
            case .failure(let e): self.notifyClose(e.localizedDescription)
            }
        }
    }

    public func send(_ text: String) { task?.send(.string(text)) { [weak self] err in if let e = err { self?.notifyClose(e.localizedDescription) } } }
    public func close() { task?.cancel(with: .normalClosure, reason: nil); task = nil }

    private func notifyClose(_ reason: String?) {
        queue.async { [weak self] in
            guard let self = self, !self.closedNotified else { return }
            self.closedNotified = true
            self.onClose?(reason)
        }
    }

    public func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol p: String?) { onOpen?() }
    public func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        notifyClose("closed:\(code.rawValue)")
    }
    public func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { if let e = error { notifyClose(e.localizedDescription) } }
}
