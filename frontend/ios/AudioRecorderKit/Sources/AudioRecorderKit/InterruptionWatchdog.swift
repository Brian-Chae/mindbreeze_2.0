import Foundation

/// 인터럽션 `began` 뒤 `ended` 알림이 오지 않는 경우(LiveKit 이 오디오 세션을 점유 등)를 대비한 타임아웃 판정.
/// 순수 로직 — 시각은 호출부가 주입한다(시험 용이). `began` 후 `timeout` 초가 지나면 복귀를 시도하고,
/// 시도에 실패하면 `timeout` 초마다 다시 시도한다(전화 통화 중 등 정당한 인터럽션은 엔진 기동 실패로 상태 유지).
public struct InterruptionWatchdog: Equatable {
    public let timeout: TimeInterval
    private var since: TimeInterval? = nil
    private var lastAttempt: TimeInterval? = nil

    public init(timeout: TimeInterval = 10) { self.timeout = timeout }

    public var isInterrupted: Bool { since != nil }

    public mutating func began(at now: TimeInterval) {
        if since == nil { since = now; lastAttempt = nil }
    }

    public mutating func ended() { since = nil; lastAttempt = nil }

    public func shouldAttempt(at now: TimeInterval) -> Bool {
        guard let s = since else { return false }
        return now - (lastAttempt ?? s) >= timeout
    }

    public mutating func attempted(at now: TimeInterval) { lastAttempt = now }
}
