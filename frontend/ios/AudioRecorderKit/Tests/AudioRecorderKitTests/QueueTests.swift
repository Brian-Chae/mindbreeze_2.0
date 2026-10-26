import XCTest
@testable import AudioRecorderKit

final class QueueTests: XCTestCase {
    private func stage(_ dir: URL, bytes: Int) -> URL {
        let u = dir.appendingPathComponent(UUID().uuidString + ".tmp")
        try? Data(repeating: 7, count: bytes).write(to: u); return u
    }

    // I3 — 저장→목록(오름차순)→삭제, 재시작(새 인스턴스) 후 복원
    func testCommitListRemoveAndRestoreAscending() throws {
        let root = tempDir()
        var q: ChunkQueue? = ChunkQueue(root: root)
        for i in [2, 0, 10, 1] { try q!.commit(staged: stage(root, bytes: 100), sessionId: "s1", index: i) }
        q = nil
        let q2 = ChunkQueue(root: root)                       // 재시작
        XCTAssertEqual(q2.pending().map(\.index), [0, 1, 2, 10])
        q2.remove(sessionId: "s1", index: 0)
        XCTAssertEqual(q2.pending().map(\.index), [1, 2, 10])
        XCTAssertEqual(q2.pendingCount(sessionId: "s1"), 3)
    }

    func testDiskCapThrowsDiskFull() throws {
        let root = tempDir()
        let q = ChunkQueue(root: root, maxBytes: 250)
        try q.commit(staged: stage(root, bytes: 100), sessionId: "s", index: 0)
        try q.commit(staged: stage(root, bytes: 100), sessionId: "s", index: 1)
        XCTAssertThrowsError(try q.commit(staged: stage(root, bytes: 100), sessionId: "s", index: 2)) {
            XCTAssertEqual($0 as? ChunkQueueError, .diskFull)
        }
    }

    func testSessionStateRoundTrip() throws {
        let root = tempDir()
        let q = ChunkQueue(root: root)
        try q.saveState(RecorderPersistedState(sessionId: "s9", apiBase: "https://x/api/v1", nextIndex: 7, lastConfirmed: 6))
        XCTAssertEqual(ChunkQueue(root: root).loadState()?.nextIndex, 7)
        XCTAssertEqual(ChunkQueue(root: root).loadState()?.sessionId, "s9")
    }

    func testBackoffSchedule() {
        XCTAssertEqual((0..<8).map { Backoff.delay(attempt: $0) }, [1, 2, 4, 8, 16, 30, 30, 30])
    }
}
