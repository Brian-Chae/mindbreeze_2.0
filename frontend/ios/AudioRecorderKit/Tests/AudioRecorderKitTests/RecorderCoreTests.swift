import XCTest
@testable import AudioRecorderKit

final class RecorderCoreTests: XCTestCase {
    private func make(chunk: Int = 4410) -> (RecorderCore, ChunkQueue, FakeHTTP, EventBox) {
        let root = tempDir()
        let http = FakeHTTP { _ in ok() }
        let q = ChunkQueue(root: root)
        let store = InMemoryAudioCredentialStore(); store.save(AudioCredential(accessToken: "a", refreshToken: "r", apiBase: "https://api.test/api/v1"))
        let events = EventBox()
        let up = ChunkUploader(queue: q, tokens: AudioTokenProvider(store: store, http: http), http: http, sleep: { _ in }, onEvent: { events.add($0) })
        let core = RecorderCore(sessionId: "S", apiBase: "https://api.test/api/v1", startIndex: 5, queue: q, uploader: up,
                                sampleRate: 44_100, chunkSamples: chunk, onEvent: { events.add($0) })
        return (core, q, http, events)
    }

    // I5 — 인덱스 규칙: 시작 인덱스부터, pause 시 부분 청크 확정 후 진행, 마이크 오프 구간은 제외
    func testIndexRulesAcrossPauseAndMicOff() async throws {
        let (core, q, _, _) = make()
        core.begin()
        core.feed(sine(count: 4410 + 1000))            // 청크 5 확정 + 1000 잔여
        core.apply(.pause)                              // 잔여 1000 → 청크 6 확정
        core.feed(sine(count: 5000))                    // 일시정지 중 → 무시
        core.apply(.resume)
        core.apply(.micEnabled(false))                  // 잔여 없음 → 청크 없음
        core.feed(sine(count: 5000))                    // 마이크 오프 → 제외
        core.apply(.micEnabled(true))
        core.feed(sine(count: 4410))                    // 청크 7
        let res = await core.stop(timeout: 0.2)
        XCTAssertEqual(q.pending().map(\.index).sorted() + [], [])  // 업로드 완료(가짜 서버 200)
        XCTAssertEqual(res.lastChunkIndex, 7)
        XCTAssertEqual(res.pendingCount, 0)
        XCTAssertEqual(res.uploadedCount, 3)
    }

    // 정지 시 잔여 조각 확정, state.json 반영
    func testStopFlushesTailAndPersistsState() async throws {
        let (core, q, http, _) = make()
        core.begin()
        core.feed(sine(count: 2000))
        let res = await core.stop(timeout: 0.2)
        XCTAssertEqual(res.lastChunkIndex, 5)
        XCTAssertEqual(http.uploadRequests.count, 1)
        XCTAssertEqual(q.loadState()?.nextIndex, 6)
    }

    // 서버 장애 시 stop 은 timeout 내 반환하고 pendingCount 를 보고
    func testStopReportsPendingWhenServerDown() async throws {
        let (core, q, http, _) = make()
        http.responder = { _ in status(503) }
        core.begin(); core.feed(sine(count: 4410))
        let res = await core.stop(timeout: 0.3)
        XCTAssertEqual(res.pendingCount, 1)
        XCTAssertEqual(q.pending().count, 1)
    }
}
