import Foundation

public enum OwnershipRejection: Equatable { case nativeDisabled, jsOwnsBand }
public enum AcquireResult: Equatable { case acquired, rejected(OwnershipRejection) }

/// 한 밴드를 JS(@capacitor-community/bluetooth-le)와 native 가 동시에 소유하지 못하게 하는 단일 게이트.
/// 기능 플래그 기본 off — off 이면 native 는 어떤 BLE 도 만지지 않고 현행(JS) 동작이 그대로다.
public final class BandOwnership {
    public static let enabledKey = "mb.native_measurement.enabled"
    private let defaults: UserDefaults
    private let lock = NSLock()
    private var jsOwning = false
    private var nativeOwning = false

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var nativeEnabled: Bool {
        get { defaults.bool(forKey: Self.enabledKey) }
        set { defaults.set(newValue, forKey: Self.enabledKey) }
    }
    public var isNativeOwning: Bool { lock.lock(); defer { lock.unlock() }; return nativeOwning }

    public func tryAcquireNative() -> AcquireResult {
        lock.lock(); defer { lock.unlock() }
        guard nativeEnabled else { return .rejected(.nativeDisabled) }
        if jsOwning { return .rejected(.jsOwnsBand) }
        nativeOwning = true
        return .acquired
    }
    public func releaseNative() { lock.lock(); nativeOwning = false; lock.unlock() }

    /// JS 가 밴드를 잡거나 놓았음을 알린다. native 가 소유 중이면 JS 소유는 거절(false).
    @discardableResult
    public func setJSOwning(_ on: Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if on && nativeOwning { return false }
        jsOwning = on
        return true
    }
}

/// 비동기 콜백의 세대 검사. 재연결·재시작 뒤 도착한 구 세대 콜백은 폐기한다.
public final class GenerationFence {
    private var value: UInt64 = 0
    private let lock = NSLock()
    public init() {}
    @discardableResult public func advance() -> UInt64 { lock.lock(); defer { lock.unlock() }; value += 1; return value }
    public func isCurrent(_ g: UInt64) -> Bool { lock.lock(); defer { lock.unlock() }; return g == value }
    public var current: UInt64 { lock.lock(); defer { lock.unlock() }; return value }
}

/// 서버가 발급한 수집 owner generation. 더 높은 세대가 존재하면 이 기기는 fence 되어 live 갱신을 멈춘다(로컬 journal 은 유지).
public struct OwnerLease: Equatable {
    public let streamId: String
    public let generation: UInt64
    public private(set) var newestObserved: UInt64
    public init(streamId: String, generation: UInt64) { self.streamId = streamId; self.generation = generation; self.newestObserved = generation }
    public mutating func observe(serverGeneration g: UInt64) { newestObserved = max(newestObserved, g) }
    public var mustStop: Bool { newestObserved > generation }
    public var mayWriteLive: Bool { !mustStop }
}
