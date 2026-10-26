import Foundation

public enum RecorderState: String, Sendable { case idle, recording, paused, micOff, stopping, stopped, error }
public enum StateReason: String, Sendable { case user, interruption, routeChange = "route_change", appRestart = "app_restart", system }
public enum RecorderErrorCode: String, Sendable {
    case permissionDenied = "permission_denied", sessionInterrupted = "session_interrupted", audioEngineFailed = "audio_engine_failed"
    case authExpired = "auth_expired", uploadFailed = "upload_failed", diskFull = "disk_full", unsupported
}

public enum RecorderEvent: Sendable {
    case chunkUploaded(sessionId: String, index: Int, size: Int, uploaded: Int, pending: Int)
    case stateChanged(sessionId: String?, state: RecorderState, reason: StateReason?)
    case error(sessionId: String?, code: RecorderErrorCode, message: String, recoverable: Bool)
}

public struct RecorderStatus: Sendable {
    public var state: RecorderState, sessionId: String?, nextChunkIndex: Int, uploadedCount: Int, pendingCount: Int, lastUploadedIndex: Int
    public init(state: RecorderState, sessionId: String?, nextChunkIndex: Int, uploadedCount: Int, pendingCount: Int, lastUploadedIndex: Int) {
        self.state = state; self.sessionId = sessionId; self.nextChunkIndex = nextChunkIndex
        self.uploadedCount = uploadedCount; self.pendingCount = pendingCount; self.lastUploadedIndex = lastUploadedIndex
    }
}

public struct RecorderStopResult: Sendable, Equatable {
    public var pendingCount: Int, uploadedCount: Int, lastChunkIndex: Int
}

/// state.json — 재시작 복원용(토큰은 담지 않는다)
public struct RecorderPersistedState: Codable, Equatable, Sendable {
    public var sessionId: String, apiBase: String, nextIndex: Int, lastConfirmed: Int
    public init(sessionId: String, apiBase: String, nextIndex: Int, lastConfirmed: Int) {
        self.sessionId = sessionId; self.apiBase = apiBase; self.nextIndex = nextIndex; self.lastConfirmed = lastConfirmed
    }
}

/// 지수 백오프 1,2,4,8,16,30,30…
public enum Backoff {
    public static func delay(attempt: Int) -> TimeInterval { min(30, pow(2, Double(max(0, attempt)))) }
}
