import Foundation

public protocol WebSocketTransport: AnyObject {
    var onOpen: (() -> Void)? { get set }
    var onText: ((String) -> Void)? { get set }
    var onClose: ((String?) -> Void)? { get set }
    func connect(url: URL)
    func send(_ text: String)
    func close()
}

public enum AckError: Error, Equatable { case timeout, disconnected, notConnected }

/// 최소 Socket.IO v4 클라이언트(Engine.IO v4, websocket-only). 인증·ping/pong·ack·재연결(backoff 0.5/1/2/4s+jitter)을 담당한다.
/// 모든 호출은 단일 직렬 큐(`queue`) 위에서 일어난다는 전제이며, 테스트는 직접 호출한다. 재연결마다 `auth()` 로 최신 토큰을 다시 읽는다.
public final class SocketIOClient {
    public typealias Handler = (_ args: [Any], _ reply: (([Any]) -> Void)?) -> Void
    public static let backoffSeconds: [TimeInterval] = [0.5, 1, 2, 4]

    private let baseURL: URL, namespace: String
    private let scheduler: Scheduler
    private let auth: () -> [String: Any]
    private let transportFactory: () -> WebSocketTransport
    private let jitter: () -> TimeInterval

    public var onConnect: (() -> Void)?
    public var onDisconnect: ((String) -> Void)?
    public var onConnectError: ((String) -> Void)?
    public private(set) var isConnected = false

    private var transport: WebSocketTransport?
    private var handlers: [String: Handler] = [:]
    private var pending: [Int: (timer: Cancellable?, cb: (Result<Any?, AckError>) -> Void)] = [:]
    private var nextId = 0
    private var wantConnected = false
    private var attempt = 0
    private var pingWatchdog: Cancellable?
    private var reconnectTimer: Cancellable?
    private var pingInterval: TimeInterval = 25, pingTimeout: TimeInterval = 20
    private var engineOpen = false

    public init(baseURL: URL, namespace: String, scheduler: Scheduler, jitter: @escaping () -> TimeInterval = { Double.random(in: 0...0.25) },
                auth: @escaping () -> [String: Any], transportFactory: @escaping () -> WebSocketTransport) {
        self.baseURL = baseURL; self.namespace = namespace; self.scheduler = scheduler
        self.jitter = jitter; self.auth = auth; self.transportFactory = transportFactory
    }

    public func on(_ event: String, _ h: @escaping Handler) { handlers[event] = h }

    public func connect() {
        wantConnected = true
        reconnectTimer?.cancel(); reconnectTimer = nil
        openTransport()
    }

    public func close() {
        wantConnected = false
        reconnectTimer?.cancel(); reconnectTimer = nil
        pingWatchdog?.cancel(); pingWatchdog = nil
        let t = transport
        if isConnected { t?.send(SocketIOCodec.encode(SocketIOPacket(kind: .disconnect, namespace: namespace, id: nil))) }
        teardown(reason: "client close", reconnect: false)
        t?.close()
    }

    /// 로컬 연결만 끊고 backoff 재연결을 시도한다(예: 토큰 갱신 후 새 auth 로 다시 붙기).
    public func reconnectNow() {
        reconnectTimer?.cancel(); reconnectTimer = nil
        attempt = 0
        let old = transport
        transport = nil
        teardown(reason: "reconnect requested", reconnect: false)
        old?.onClose = nil; old?.close()
        if wantConnected { openTransport() }
    }

    private func openTransport() {
        transport?.onClose = nil
        let t = transportFactory()
        transport = t
        engineOpen = false
        t.onOpen = {}
        t.onText = { [weak self, weak t] s in guard let self = self, self.transport === t else { return }; self.handleEngine(s) }
        t.onClose = { [weak self, weak t] r in guard let self = self, self.transport === t else { return }; self.handleClose(r ?? "transport close") }
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        comps.scheme = (comps.scheme == "https" || comps.scheme == "wss") ? "wss" : "ws"
        comps.path = "/socket.io/"
        comps.queryItems = [URLQueryItem(name: "EIO", value: "4"), URLQueryItem(name: "transport", value: "websocket")]
        t.connect(url: comps.url!)
    }

    // MARK: Engine.IO

    private func handleEngine(_ text: String) {
        guard let first = text.first else { return }
        switch first {
        case "0":
            engineOpen = true
            if let d = String(text.dropFirst()).data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                if let pi = (o["pingInterval"] as? NSNumber)?.doubleValue { pingInterval = pi / 1000 }
                if let pt = (o["pingTimeout"] as? NSNumber)?.doubleValue { pingTimeout = pt / 1000 }
            }
            armWatchdog()
            transport?.send(SocketIOCodec.encode(.connect(namespace: namespace, payload: auth())))   // 인증은 CONNECT 패킷 auth
        case "2":
            transport?.send("3"); armWatchdog()
        case "1":
            handleClose("transport close")
        case "4":
            armWatchdog()
            handleSocketIO(String(text))
        default: break
        }
    }

    private func armWatchdog() {
        pingWatchdog?.cancel()
        pingWatchdog = scheduler.schedule(after: pingInterval + pingTimeout) { [weak self] in
            guard let self = self else { return }
            let t = self.transport
            self.handleClose("ping timeout")
            t?.close()
        }
    }

    // MARK: Socket.IO

    private func handleSocketIO(_ text: String) {
        guard let p = try? SocketIOCodec.decode(text), p.namespace == namespace else { return }
        switch p.kind {
        case .connect:
            attempt = 0
            isConnected = true
            onConnect?()
        case .connectError:
            isConnected = false
            onConnectError?(p.errorMessage ?? "connect_error")
            // 서버가 소켓을 닫는다 — 재연결 판단은 handleClose 에서 한다(만료 토큰 무한 루프 방지는 호출자가 auth 로 처리).
        case .disconnect:
            handleClose("io server disconnect")
        case .event:
            let reply: (([Any]) -> Void)? = p.id.map { id in { [weak self] args in
                guard let self = self, self.isConnected else { return }
                self.transport?.send(SocketIOCodec.encode(.ack(namespace: self.namespace, id: id, args: args)))
            } }
            handlers[p.name]?(p.args, reply)
        case .ack:
            guard let id = p.id, let entry = pending.removeValue(forKey: id) else { return }   // 이미 timeout 된 늦은 ACK 는 무시
            entry.timer?.cancel()
            entry.cb(.success(p.args.first))
        }
    }

    public func emit(_ name: String, _ payload: Any? = nil, ackTimeout: TimeInterval = 2, ack: ((Result<Any?, AckError>) -> Void)? = nil) {
        guard isConnected, let t = transport else { ack?(.failure(.notConnected)); return }
        var id: Int?
        if let ack = ack {
            nextId += 1; let myId = nextId; id = myId
            let timer = scheduler.schedule(after: ackTimeout) { [weak self] in
                guard let self = self, let e = self.pending.removeValue(forKey: myId) else { return }
                e.cb(.failure(.timeout))
            }
            pending[myId] = (timer, ack)
        }
        t.send(SocketIOCodec.encode(.event(namespace: namespace, id: id, name: name, args: payload.map { [$0] } ?? [])))
    }

    // MARK: 끊김·재연결

    private func handleClose(_ reason: String) {
        let was = isConnected
        teardown(reason: reason, reconnect: true)
        if was || engineOpen == false || true { onDisconnect?(reason) }
    }

    private func teardown(reason: String, reconnect: Bool) {
        isConnected = false
        engineOpen = false
        pingWatchdog?.cancel(); pingWatchdog = nil
        let p = pending; pending = [:]
        for (_, e) in p { e.timer?.cancel(); e.cb(.failure(.disconnected)) }
        if reconnect && wantConnected && reconnectTimer == nil {
            let base = Self.backoffSeconds[min(attempt, Self.backoffSeconds.count - 1)]
            attempt += 1
            reconnectTimer = scheduler.schedule(after: base + jitter()) { [weak self] in
                guard let self = self else { return }
                self.reconnectTimer = nil
                if self.wantConnected { self.openTransport() }
            }
        }
    }
}

extension SocketIOPacket {
    init(kind: Kind, namespace: String, id: Int?, name: String = "", args: [Any] = [], connectPayload: [String: Any]? = nil) {
        self.kind = kind; self.namespace = namespace; self.id = id; self.name = name; self.args = args
        self.errorMessage = nil; self.connectPayload = connectPayload
    }
}
