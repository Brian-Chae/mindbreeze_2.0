import Foundation
import Security

/// 계정 scope 자격. 로그/description 에 토큰 값을 절대 내보내지 않는다.
public struct Credential: CustomStringConvertible, CustomDebugStringConvertible {
    public var accountId: String
    public var accessToken: String
    public var refreshToken: String
    public var apiBase: String
    public init(accountId: String, accessToken: String, refreshToken: String, apiBase: String) {
        self.accountId = accountId; self.accessToken = accessToken; self.refreshToken = refreshToken; self.apiBase = apiBase
    }
    public var description: String { "Credential(account: \(accountId), tokens: <redacted>)" }
    public var debugDescription: String { description }
}

public protocol CredentialStore: AnyObject {
    /// 불투명 핸들을 돌려준다(웹뷰에는 핸들만 전달). 같은 계정이면 같은 핸들을 갱신한다.
    @discardableResult func save(_ c: Credential) throws -> String
    func load(handle: String) throws -> Credential?
    func update(handle: String, access: String, refresh: String?) throws
    func wipe(accountId: String)
}

public final class InMemoryCredentialStore: CredentialStore {
    private var byHandle: [String: Credential] = [:], handleOfAccount: [String: String] = [:]
    private let lock = NSLock()
    public init() {}
    public func save(_ c: Credential) throws -> String {
        lock.lock(); defer { lock.unlock() }
        let h = handleOfAccount[c.accountId] ?? Self.newHandle()
        byHandle[h] = c; handleOfAccount[c.accountId] = h; return h
    }
    public func load(handle: String) throws -> Credential? { lock.lock(); defer { lock.unlock() }; return byHandle[handle] }
    public func update(handle: String, access: String, refresh: String?) throws {
        lock.lock(); defer { lock.unlock() }
        guard var c = byHandle[handle] else { return }
        c.accessToken = access; if let r = refresh { c.refreshToken = r }; byHandle[handle] = c
    }
    public func wipe(accountId: String) {
        lock.lock(); defer { lock.unlock() }
        if let h = handleOfAccount.removeValue(forKey: accountId) { byHandle[h] = nil }
    }
    static func newHandle() -> String {
        var b = [UInt8](repeating: 0, count: 24); _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
        return Data(b).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// iOS Keychain. 계정별 항목, 첫 unlock 이후 접근(잠금 중 재연결/토큰 갱신 위해), iCloud/백업 제외(ThisDeviceOnly).
public final class KeychainCredentialStore: CredentialStore {
    private let service = "com.looxidlabs.mindbreeze2.measurement"
    public init() {}
    private func base(_ account: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
    private func encode(_ c: Credential, handle: String) -> Data {
        (try? JSONSerialization.data(withJSONObject: ["h": handle, "a": c.accountId, "at": c.accessToken, "rt": c.refreshToken, "b": c.apiBase])) ?? Data()
    }
    private func decode(_ d: Data) -> (String, Credential)? {
        guard let o = try? JSONSerialization.jsonObject(with: d) as? [String: String], let h = o["h"], let a = o["a"], let at = o["at"], let rt = o["rt"], let b = o["b"] else { return nil }
        return (h, Credential(accountId: a, accessToken: at, refreshToken: rt, apiBase: b))
    }
    public func save(_ c: Credential) throws -> String {
        let h = existingHandle(account: c.accountId) ?? InMemoryCredentialStore.newHandle()
        var q = base("acct:" + c.accountId)
        SecItemDelete(q as CFDictionary)
        q[kSecValueData as String] = encode(c, handle: h)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let st = SecItemAdd(q as CFDictionary, nil)
        guard st == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(st)) }
        return h
    }
    private func existingHandle(account: String) -> String? {
        var q = base("acct:" + account); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return decode(d)?.0
    }
    public func load(handle: String) throws -> Credential? {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitAll, kSecReturnAttributes as String: false]
        q[kSecReturnData as String] = true
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let arr = out as? [Data] else { return nil }
        return arr.compactMap(decode).first(where: { $0.0 == handle })?.1
    }
    public func update(handle: String, access: String, refresh: String?) throws {
        guard var c = try load(handle: handle) else { return }
        c.accessToken = access; if let r = refresh { c.refreshToken = r }
        var q = base("acct:" + c.accountId)
        SecItemDelete(q as CFDictionary)
        q[kSecValueData as String] = encode(c, handle: handle)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
    public func wipe(accountId: String) { SecItemDelete(base("acct:" + accountId) as CFDictionary) }
}

public protocol HTTPClient: AnyObject {
    func send(_ req: URLRequest, completion: @escaping (Result<(Int, Data, [String: String]), Error>) -> Void)
}

public final class URLSessionHTTPClient: HTTPClient {
    private let session: URLSession
    public init(session: URLSession = URLSession(configuration: .ephemeral)) { self.session = session }
    public func send(_ req: URLRequest, completion: @escaping (Result<(Int, Data, [String: String]), Error>) -> Void) {
        session.dataTask(with: req) { d, r, e in
            if let e = e { completion(.failure(e)); return }
            guard let h = r as? HTTPURLResponse else { completion(.failure(URLError(.badServerResponse))); return }
            var hs: [String: String] = [:]
            for (k, v) in h.allHeaderFields { if let k = k as? String, let v = v as? String { hs[k] = v } }
            completion(.success((h.statusCode, d ?? Data(), hs)))
        }.resume()
    }
}

/// access 토큰 소유·갱신(native). single-flight: 동시 갱신은 하나로 병합해 refresh 토큰 회전 충돌(재사용 감지→전체 로그아웃)을 막는다.
public final class TokenProvider {
    private let store: CredentialStore, http: HTTPClient, apiBase: URL
    private var waiters: [String: [(Result<String, Error>) -> Void]] = [:]
    private let lock = NSLock()
    public init(store: CredentialStore, http: HTTPClient, apiBase: URL) { self.store = store; self.http = http; self.apiBase = apiBase }

    public func accessToken(handle: String, forceRefresh: Bool = false, completion: @escaping (Result<String, Error>) -> Void) {
        guard let c = try? store.load(handle: handle) else { completion(.failure(TokenRefreshError.invalid)); return }
        if !forceRefresh, !Self.isExpiring(c.accessToken) { completion(.success(c.accessToken)); return }
        lock.lock()
        if waiters[handle] != nil { waiters[handle]!.append(completion); lock.unlock(); return }
        waiters[handle] = [completion]
        lock.unlock()
        var req = URLRequest(url: apiBase.appendingPathComponent("auth/refresh"))
        req.httpMethod = "POST"; req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type"); req.setValue("capacitor", forHTTPHeaderField: "X-MB-Native")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": c.refreshToken])
        http.send(req) { [weak self] result in
            guard let self = self else { return }
            let outcome: Result<String, Error>
            switch result {
            case .failure: outcome = .failure(TokenRefreshError.transient)
            case .success(let (status, body, headers)):
                if status == 200, let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any], let at = o["access_token"] as? String {
                    let next = headers.first(where: { $0.key.lowercased() == "x-mb-refresh-token" })?.value ?? (o["refresh_token"] as? String)
                    try? self.store.update(handle: handle, access: at, refresh: next)
                    outcome = .success(at)
                } else if status == 400 || status == 401 || status == 403 { outcome = .failure(TokenRefreshError.invalid) }
                else { outcome = .failure(TokenRefreshError.transient) }
            }
            self.lock.lock(); let ws = self.waiters.removeValue(forKey: handle) ?? []; self.lock.unlock()
            ws.forEach { $0(outcome) }
        }
    }

    /// JWT exp 를 읽어 30초 이내 만료면 true. 파싱 불가면 만료로 취급(보수적).
    static func isExpiring(_ jwt: String) -> Bool {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3 else { return true }
        var b = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        guard let d = Data(base64Encoded: b), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let exp = (o["exp"] as? NSNumber)?.doubleValue else { return true }
        return exp - Date().timeIntervalSince1970 < 30
    }
}
