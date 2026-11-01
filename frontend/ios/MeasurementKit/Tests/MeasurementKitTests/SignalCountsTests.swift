import XCTest
@testable import MeasurementKit

/// SDD-264: archive.counts additive `signals` — raw 청크 1개 = 큐 항목 1개를 신호별·상태별로 센다(Android SignalCountsTest 와 같은 규칙).
final class SignalCountsTests: XCTestCase {
    var dir: URL!
    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("sc-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func raw(_ sig: String, _ idx: Int, kind: ArchiveKind = .raw) -> ArchiveItem {
        var i = ArchiveItem(alias: "\(kind.rawValue)-\(sig)-\(idx)", kind: kind, file: "f-\(sig)-\(idx)", sha256: String(repeating: "a", count: 64), sizeBytes: 10, captureStreamId: "s", monotonicRange: nil)
        i.meta = ["header": ["signal_type": sig, "chunk_index": idx]]
        return i
    }

    func testCountsPerSignalAndStateAndExcludesFeature() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none)
        for i in 0..<6 { try q.enqueue(raw("eeg", i)) }
        try q.enqueue(raw("ppg", 0)); try q.enqueue(raw("ppg", 1)); try q.enqueue(raw("acc", 0))
        try q.enqueue(raw("eeg", 99, kind: .feature))
        try q.markVerified(alias: "raw-eeg-0")
        try q.attach(taskId: 1, alias: "raw-eeg-1", url: "u")
        try q.apply(ArchiveDecision(stage: .presign, action: .quarantine, code: "x", retryAfterMs: nil, splitCandidate: false), alias: "raw-eeg-2", now: 0)
        try q.apply(ArchiveDecision(stage: .presign, action: .halt, code: "x", retryAfterMs: nil, splitCandidate: false), alias: "raw-eeg-3", now: 0)
        try q.apply(ArchiveDecision(stage: .presign, action: .timeReview, code: "x", retryAfterMs: nil, splitCandidate: false), alias: "raw-eeg-4", now: 0)
        let c = q.signalCounts()
        XCTAssertEqual(Set(c.keys), ["eeg", "ppg", "acc"])
        XCTAssertEqual(c["eeg"], SignalCounts(pending: 1, uploading: 1, verified: 1, quarantined: 3))
        XCTAssertEqual(c["eeg"]?.total, 6, "feature 산출물은 제외")
        XCTAssertEqual(c["ppg"]?.total, 2); XCTAssertEqual(c["acc"]?.total, 1)
    }

    func testUnwornSignalsAreZeroAndTotalStableAcrossTransitions() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none)
        for i in 0..<3 { try q.enqueue(raw("eeg", i)) }
        XCTAssertEqual(q.signalCounts()["ppg"], SignalCounts()); XCTAssertEqual(q.signalCounts()["acc"], SignalCounts())
        let before = q.signalCounts()["eeg"]!.total
        for i in 0..<3 { try q.markVerified(alias: "raw-eeg-\(i)") }
        XCTAssertEqual(q.signalCounts()["eeg"]!.total, before, "진행돼도 총량 불변(단조)")
    }

    func testPayloadShapeMatchesAndroid() throws {
        let q = try ArchiveQueue(dir: dir, sync: .none)
        try q.enqueue(raw("eeg", 0))
        let p = ArchiveQueue.signalsPayload(q.signalCounts())
        XCTAssertEqual(Set(p.keys), ["eeg", "ppg", "acc"])
        let eeg = p["eeg"] as? [String: Int]
        XCTAssertEqual(Set(eeg?.keys.map { $0 } ?? []), ["pending", "uploading", "verified", "quarantined"])
        XCTAssertEqual(eeg?["pending"], 1)
    }

    func testSyncSnapshotDefaultsToNoSignals() {
        XCTAssertNil(SyncSnapshot().signals, "큐를 읽기 전에는 싣지 않는다(0 으로 오해 금지)")
    }
}
