import Foundation

public struct AudioHTTPResponse: Sendable {
    public var status: Int, body: Data, headers: [String: String]
    public init(status: Int, body: Data, headers: [String: String]) { self.status = status; self.body = body; self.headers = headers }
    public func header(_ name: String) -> String? { headers.first { $0.key.lowercased() == name.lowercased() }?.value }
}

public protocol AudioHTTPClient: AnyObject, Sendable {
    func send(_ req: URLRequest) async throws -> AudioHTTPResponse
}

public final class URLSessionAudioHTTPClient: AudioHTTPClient, @unchecked Sendable {
    private let session: URLSession
    public init(session: URLSession = URLSession(configuration: .ephemeral)) { self.session = session }
    public func send(_ req: URLRequest) async throws -> AudioHTTPResponse {
        let (data, resp) = try await session.data(for: req)
        guard let h = resp as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        var hs: [String: String] = [:]
        for (k, v) in h.allHeaderFields { if let k = k as? String, let v = v as? String { hs[k] = v } }
        return AudioHTTPResponse(status: h.statusCode, body: data, headers: hs)
    }
}

public enum TokenRefreshOutcome: Equatable, Sendable { case refreshed(String), invalid, transient }

/// 401 시 POST {apiBase}/auth/refresh. single-flight(동시 갱신은 하나로) — refresh 토큰 회전 충돌 방지.
public final class AudioTokenProvider: @unchecked Sendable {
    private let store: AudioCredentialStore
    private let http: AudioHTTPClient
    private let lock = NSLock()
    private var inflight: Task<TokenRefreshOutcome, Never>?

    public init(store: AudioCredentialStore, http: AudioHTTPClient) { self.store = store; self.http = http }

    public func currentAccessToken() -> String? { store.load()?.accessToken }
    public func credential() -> AudioCredential? { store.load() }

    public func refresh() async -> TokenRefreshOutcome {
        let t: Task<TokenRefreshOutcome, Never> = claim()
        let r = await t.value
        return r
    }
    private func claim() -> Task<TokenRefreshOutcome, Never> {
        lock.lock(); defer { lock.unlock() }
        if let t = inflight { return t }
        let t = Task<TokenRefreshOutcome, Never> { [self] in
            let r = await doRefresh()
            lock.lock(); inflight = nil; lock.unlock()
            return r
        }
        inflight = t
        return t
    }
    private func doRefresh() async -> TokenRefreshOutcome {
        guard let c = store.load(), let url = URL(string: c.apiBase + "/auth/refresh") else { return .invalid }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"; req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("capacitor", forHTTPHeaderField: "X-MB-Native")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": c.refreshToken])
        do {
            let r = try await http.send(req)
            if r.status == 200, let o = try? JSONSerialization.jsonObject(with: r.body) as? [String: Any], let at = o["access_token"] as? String {
                let next = r.header("X-MB-Refresh-Token") ?? (o["refresh_token"] as? String)
                store.update(access: at, refresh: next)
                return .refreshed(at)
            }
            if r.status == 400 || r.status == 401 || r.status == 403 { return .invalid }
            return .transient
        } catch { return .transient }
    }
}
