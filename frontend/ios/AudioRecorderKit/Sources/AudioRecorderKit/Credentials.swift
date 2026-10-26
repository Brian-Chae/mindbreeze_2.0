import Foundation
import Security

/// 토큰은 description 에 노출하지 않는다.
public struct AudioCredential: CustomStringConvertible, CustomDebugStringConvertible, Equatable, Sendable {
    public var accessToken: String, refreshToken: String, apiBase: String
    public init(accessToken: String, refreshToken: String, apiBase: String) {
        self.accessToken = accessToken; self.refreshToken = refreshToken; self.apiBase = apiBase
    }
    public var description: String { "AudioCredential(tokens: <redacted>)" }
    public var debugDescription: String { description }
}

public protocol AudioCredentialStore: AnyObject, Sendable {
    func save(_ c: AudioCredential)
    func load() -> AudioCredential?
    func update(access: String, refresh: String?)
    func wipe()
}

public final class InMemoryAudioCredentialStore: AudioCredentialStore, @unchecked Sendable {
    private var c: AudioCredential?
    private let lock = NSLock()
    public init() {}
    public func save(_ c: AudioCredential) { lock.lock(); self.c = c; lock.unlock() }
    public func load() -> AudioCredential? { lock.lock(); defer { lock.unlock() }; return c }
    public func update(access: String, refresh: String?) {
        lock.lock(); defer { lock.unlock() }
        guard var x = c else { return }
        x.accessToken = access; if let r = refresh { x.refreshToken = r }; c = x
    }
    public func wipe() { lock.lock(); c = nil; lock.unlock() }
}

/// Keychain(측정 모듈과 별도 service). 첫 unlock 이후 접근(화면 잠금 중 갱신 위해), 이 기기 한정.
public final class KeychainAudioCredentialStore: AudioCredentialStore, @unchecked Sendable {
    private let service = "com.looxidlabs.mindbreeze2.audiorecorder"
    private let account = "recording"
    private let lock = NSLock()
    public init() {}

    private var base: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }

    public func save(_ c: AudioCredential) {
        lock.lock(); defer { lock.unlock() }
        writeLocked(c)
    }
    private func writeLocked(_ c: AudioCredential) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["at": c.accessToken, "rt": c.refreshToken, "b": c.apiBase]) else { return }
        SecItemDelete(base as CFDictionary)
        var q = base
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
    public func load() -> AudioCredential? {
        lock.lock(); defer { lock.unlock() }
        return loadLocked()
    }
    private func loadLocked() -> AudioCredential? {
        var q = base; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data,
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: String],
              let at = o["at"], let rt = o["rt"], let b = o["b"] else { return nil }
        return AudioCredential(accessToken: at, refreshToken: rt, apiBase: b)
    }
    public func update(access: String, refresh: String?) {
        lock.lock(); defer { lock.unlock() }
        guard var c = loadLocked() else { return }
        c.accessToken = access; if let r = refresh { c.refreshToken = r }
        writeLocked(c)
    }
    public func wipe() { lock.lock(); SecItemDelete(base as CFDictionary); lock.unlock() }
}
