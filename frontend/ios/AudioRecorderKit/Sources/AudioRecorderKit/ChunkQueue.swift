import Foundation

public enum ChunkQueueError: Error, Equatable { case diskFull, io }

public struct QueuedChunk: Equatable, Sendable {
    public let sessionId: String, index: Int, url: URL, size: Int
}

/// 디스크 큐: root/chunks/{sessionId}/{index}.m4a + root/state.json. 상한 초과 시 diskFull.
public final class ChunkQueue: @unchecked Sendable {
    public let root: URL
    public let maxBytes: Int
    private let lock = NSLock()
    private let fm = FileManager.default

    public init(root: URL, maxBytes: Int = 200 * 1024 * 1024) {
        self.root = root; self.maxBytes = maxBytes
        try? fm.createDirectory(at: chunksDir, withIntermediateDirectories: true)
    }
    private var chunksDir: URL { root.appendingPathComponent("chunks", isDirectory: true) }
    private var stateURL: URL { root.appendingPathComponent("state.json") }

    private func fileURL(_ s: String, _ i: Int) -> URL { chunksDir.appendingPathComponent(s, isDirectory: true).appendingPathComponent("\(i).m4a") }

    /// 스테이징 파일을 큐로 원자적으로 옮긴다(이동). 상한 초과면 스테이징 파일을 지우고 throw.
    public func commit(staged: URL, sessionId: String, index: Int) throws {
        lock.lock(); defer { lock.unlock() }
        let size = (try? fm.attributesOfItem(atPath: staged.path)[.size] as? Int) ?? 0
        if totalBytesLocked() + size > maxBytes { try? fm.removeItem(at: staged); throw ChunkQueueError.diskFull }
        let dst = fileURL(sessionId, index)
        do {
            try fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? fm.removeItem(at: dst)
            try fm.moveItem(at: staged, to: dst)
        } catch { throw ChunkQueueError.io }
    }

    public func pending() -> [QueuedChunk] {
        lock.lock(); defer { lock.unlock() }
        return pendingLocked()
    }
    private func pendingLocked() -> [QueuedChunk] {
        var out: [QueuedChunk] = []
        let sessions = (try? fm.contentsOfDirectory(atPath: chunksDir.path)) ?? []
        for s in sessions {
            let dir = chunksDir.appendingPathComponent(s, isDirectory: true)
            for f in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where f.hasSuffix(".m4a") {
                guard let idx = Int(f.dropLast(4)) else { continue }
                let u = dir.appendingPathComponent(f)
                out.append(QueuedChunk(sessionId: s, index: idx, url: u, size: (try? fm.attributesOfItem(atPath: u.path)[.size] as? Int) ?? 0))
            }
        }
        return out.sorted { ($0.sessionId, $0.index) < ($1.sessionId, $1.index) }
    }
    private func totalBytesLocked() -> Int { pendingLocked().reduce(0) { $0 + $1.size } }

    public func pendingCount(sessionId: String) -> Int { pending().filter { $0.sessionId == sessionId }.count }

    public func remove(sessionId: String, index: Int) {
        lock.lock(); defer { lock.unlock() }
        try? fm.removeItem(at: fileURL(sessionId, index))
    }

    public func saveState(_ s: RecorderPersistedState) throws {
        lock.lock(); defer { lock.unlock() }
        let d = try JSONEncoder().encode(s)
        try d.write(to: stateURL, options: .atomic)
    }
    public func loadState() -> RecorderPersistedState? {
        lock.lock(); defer { lock.unlock() }
        guard let d = try? Data(contentsOf: stateURL) else { return nil }
        return try? JSONDecoder().decode(RecorderPersistedState.self, from: d)
    }
    public func clearState() { lock.lock(); defer { lock.unlock() }; try? fm.removeItem(at: stateURL) }

    /// 스테이징(미확정) 파일 위치
    public func newStagingURL() -> URL {
        try? fm.createDirectory(at: root.appendingPathComponent("staging", isDirectory: true), withIntermediateDirectories: true)
        return root.appendingPathComponent("staging", isDirectory: true).appendingPathComponent(UUID().uuidString + ".m4a")
    }
}
