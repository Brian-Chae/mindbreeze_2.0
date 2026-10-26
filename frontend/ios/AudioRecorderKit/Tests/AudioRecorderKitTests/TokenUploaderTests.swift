import XCTest
@testable import AudioRecorderKit

final class TokenUploaderTests: XCTestCase {
    private let base = "https://api.test/api/v1"

    private func fixture(http: FakeHTTP, creds: AudioCredential? = AudioCredential(accessToken: "AT0", refreshToken: "RT0", apiBase: "https://api.test/api/v1"))
        -> (ChunkQueue, InMemoryAudioCredentialStore, ChunkUploader, EventBox, SleepBox) {
        let root = tempDir()
        let q = ChunkQueue(root: root)
        let store = InMemoryAudioCredentialStore()
        if let c = creds { store.save(c) }
        let tokens = AudioTokenProvider(store: store, http: http)
        let events = EventBox(), sleeps = SleepBox()
        let up = ChunkUploader(queue: q, tokens: tokens, http: http, sleep: { await sleeps.record($0) }, onEvent: { events.add($0) })
        return (q, store, up, events, sleeps)
    }
    private func add(_ q: ChunkQueue, _ idx: Int, session: String = "S") throws {
        let u = q.root.appendingPathComponent("x\(idx).tmp"); try Data("ftypdata\(idx)".utf8).write(to: u)
        try q.commit(staged: u, sessionId: session, index: idx)
    }

    // 업로드 성공 → 파일 삭제 + chunkUploaded, 요청 형식(멀티파트·Bearer)
    func testUploadSuccessDeletesAndEmits() async throws {
        let http = FakeHTTP { _ in ok() }
        let (q, _, up, events, _) = fixture(http: http)
        try add(q, 0); try add(q, 1)
        await up.drain()
        XCTAssertEqual(q.pending().count, 0)
        XCTAssertEqual(http.uploadRequests.count, 2)
        let r = http.uploadRequests[0]
        XCTAssertEqual(r.url?.absoluteString, "https://api.test/api/v1/sessions/S/audio/chunk")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer AT0")
        XCTAssertTrue(r.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        let body = String(data: r.httpBody ?? Data(), encoding: .utf8) ?? ""
        XCTAssertTrue(body.contains("name=\"chunk_index\""))
        XCTAssertTrue(body.contains("filename=\"chunk-0.m4a\""))
        XCTAssertTrue(body.contains("Content-Type: audio/mp4"))
        XCTAssertEqual(events.uploaded.map(\.index), [0, 1])
        XCTAssertEqual(events.uploaded.last?.pending, 0)
    }

    // I3 — 실패 → 백오프 1,2,4 후 성공, 큐는 보존되다 삭제
    func testFailureBacksOffThenSucceeds() async throws {
        var n = 0
        let http = FakeHTTP { _ in n += 1; return n <= 3 ? status(503) : ok() }
        let (q, _, up, _, sleeps) = fixture(http: http)
        try add(q, 0)
        await up.drain()
        let delays = await sleeps.values
        XCTAssertEqual(delays, [1, 2, 4])
        XCTAssertEqual(q.pending().count, 0)
        XCTAssertEqual(http.uploadRequests.count, 4)
    }

    // I4 — 401 → refresh(body + X-MB-Native) → 헤더 회전 저장 → 재시도 1회 성공
    func testRefreshOn401RotatesAndRetries() async throws {
        let http = FakeHTTP { req in
            if req.url!.path.hasSuffix("/auth/refresh") { return ok(["X-MB-Refresh-Token": "RT1"], body: "{\"access_token\":\"AT1\"}") }
            return req.value(forHTTPHeaderField: "Authorization") == "Bearer AT1" ? ok() : status(401)
        }
        let (q, store, up, _, _) = fixture(http: http)
        try add(q, 0)
        await up.drain()
        XCTAssertEqual(q.pending().count, 0)
        XCTAssertEqual(http.refreshRequests.count, 1)
        let rr = http.refreshRequests[0]
        XCTAssertEqual(rr.value(forHTTPHeaderField: "X-MB-Native"), "capacitor")
        let b = try JSONSerialization.jsonObject(with: rr.httpBody ?? Data()) as? [String: String]
        XCTAssertEqual(b?["refresh_token"], "RT0")
        XCTAssertEqual(store.load()?.refreshToken, "RT1")
        XCTAssertEqual(store.load()?.accessToken, "AT1")
        XCTAssertEqual(http.uploadRequests.count, 2)
    }

    // I4 — refresh 4xx → auth_expired, 큐 보존, 루프 정지
    func testRefreshRejectedKeepsQueueAndEmitsAuthExpired() async throws {
        let http = FakeHTTP { req in req.url!.path.hasSuffix("/auth/refresh") ? status(401) : status(401) }
        let (q, _, up, events, _) = fixture(http: http)
        try add(q, 0); try add(q, 1)
        await up.drain()
        XCTAssertEqual(q.pending().map(\.index), [0, 1])
        XCTAssertEqual(events.errors.map(\.code), [.authExpired])
        XCTAssertEqual(events.errors.first?.recoverable, true)
        XCTAssertEqual(http.refreshRequests.count, 1)
    }

    // 토큰 값이 이벤트 메시지·description 에 노출되지 않는다
    func testNoTokenLeak() async throws {
        let http = FakeHTTP { _ in status(401) }
        let (q, _, up, events, _) = fixture(http: http)
        try add(q, 0); await up.drain()
        for e in events.errors { XCTAssertFalse(e.message.contains("AT0") || e.message.contains("RT0")) }
        XCTAssertFalse("\(AudioCredential(accessToken: "AT0", refreshToken: "RT0", apiBase: base))".contains("AT0"))
    }
}

final class EventBox: @unchecked Sendable {
    private let lock = NSLock()
    private var all: [RecorderEvent] = []
    func add(_ e: RecorderEvent) { lock.lock(); all.append(e); lock.unlock() }
    var uploaded: [(index: Int, pending: Int)] {
        lock.lock(); defer { lock.unlock() }
        return all.compactMap { if case let .chunkUploaded(_, i, _, _, p) = $0 { return (i, p) } else { return nil } }
    }
    var errors: [(code: RecorderErrorCode, message: String, recoverable: Bool)] {
        lock.lock(); defer { lock.unlock() }
        return all.compactMap { if case let .error(_, c, m, r) = $0 { return (c, m, r) } else { return nil } }
    }
    var states: [(RecorderState, StateReason?)] {
        lock.lock(); defer { lock.unlock() }
        return all.compactMap { if case let .stateChanged(_, s, r) = $0 { return (s, r) } else { return nil } }
    }
}
actor SleepBox { var values: [TimeInterval] = []; func record(_ t: TimeInterval) { values.append(t) } }
