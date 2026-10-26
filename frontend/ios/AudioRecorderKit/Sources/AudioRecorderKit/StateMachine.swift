import Foundation

public enum RecorderInput: Equatable {
    case start, pause, resume, micEnabled(Bool), interruptionBegan, interruptionEnded, stopRequested, stopped
}

/// 상태기계. 사용자 일시정지는 인터럽션 종료로 풀리지 않는다.
public struct RecorderStateMachine {
    public private(set) var state: RecorderState = .idle
    public private(set) var lastReason: StateReason? = nil
    private var micOn = true
    private var interrupted = false
    public init() {}

    public var isCapturing: Bool { state == .recording }

    private mutating func resumeState(_ r: StateReason) {
        guard state == .paused else { return }
        state = micOn ? .recording : .micOff
        lastReason = r
    }

    public mutating func apply(_ input: RecorderInput) {
        if state == .stopped { return }
        switch input {
        case .start: state = micOn ? .recording : .micOff; lastReason = .user
        case .pause:
            if state == .recording || state == .micOff { state = .paused; lastReason = .user }
        case .resume:
            interrupted = false; resumeState(.user)
        case .micEnabled(let on):
            micOn = on
            if state == .recording || state == .micOff { state = on ? .recording : .micOff; lastReason = .user }
        case .interruptionBegan:
            if state == .recording || state == .micOff { state = .paused; interrupted = true; lastReason = .interruption }
        case .interruptionEnded:
            if interrupted { interrupted = false; resumeState(.interruption) }
        case .stopRequested: if state != .idle { state = .stopping; lastReason = .user }
        case .stopped: state = .stopped
        }
    }
}
