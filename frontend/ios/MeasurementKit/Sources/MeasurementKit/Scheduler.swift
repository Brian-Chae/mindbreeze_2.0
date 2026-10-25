import Foundation

public protocol Cancellable: AnyObject { func cancel() }
public final class CancelToken: Cancellable {
    private var fn: (() -> Void)?
    public init(_ fn: @escaping () -> Void) { self.fn = fn }
    public func cancel() { fn?(); fn = nil }
}

/// 타이머 추상화 — 실제는 전용 DispatchQueue, 시험은 수동 시계. JS 타이머/BGTask 는 쓰지 않는다.
public protocol Scheduler: AnyObject {
    @discardableResult func schedule(after: TimeInterval, _ block: @escaping () -> Void) -> Cancellable
}

public final class DispatchScheduler: Scheduler {
    private let queue: DispatchQueue
    public init(queue: DispatchQueue) { self.queue = queue }
    public func schedule(after: TimeInterval, _ block: @escaping () -> Void) -> Cancellable {
        let item = DispatchWorkItem(block: block)
        queue.asyncAfter(deadline: .now() + after, execute: item)
        return CancelToken { item.cancel() }
    }
}
