import XCTest
@testable import AudioRecorderKit

final class InterruptionWatchdogTests: XCTestCase {
    // S1 — 10초 미만이면 시도하지 않는다
    func testNoAttemptBeforeTimeout() {
        var w = InterruptionWatchdog(timeout: 10)
        w.began(at: 100)
        XCTAssertFalse(w.shouldAttempt(at: 109.9))
    }
    // S2 — 10초 경과 시 시도, 시도 직후엔 false, 다시 10초 뒤 true
    func testAttemptAfterTimeoutAndRetryInterval() {
        var w = InterruptionWatchdog(timeout: 10)
        w.began(at: 100)
        XCTAssertTrue(w.shouldAttempt(at: 110))
        w.attempted(at: 110)
        XCTAssertFalse(w.shouldAttempt(at: 115))
        XCTAssertTrue(w.shouldAttempt(at: 120))
    }
    // S3 — ended 수신 뒤에는 시도하지 않는다
    func testEndedClears() {
        var w = InterruptionWatchdog(timeout: 10)
        w.began(at: 100); w.ended()
        XCTAssertFalse(w.shouldAttempt(at: 200))
        XCTAssertFalse(w.isInterrupted)
    }
    // began 이 중복 수신돼도 최초 시각을 유지한다
    func testDuplicateBeganKeepsFirstTime() {
        var w = InterruptionWatchdog(timeout: 10)
        w.began(at: 100); w.began(at: 108)
        XCTAssertTrue(w.shouldAttempt(at: 110))
    }
    // S4 — 상태기계: 인터럽션 10초 타임아웃 복귀(interruptionEnded 합성) 시 recording 으로 돌아온다
    func testSyntheticEndedRecoversMachine() {
        var m = RecorderStateMachine(); m.apply(.start)
        m.apply(.interruptionBegan); XCTAssertEqual(m.state, .paused)
        m.apply(.interruptionEnded); XCTAssertEqual(m.state, .recording); XCTAssertEqual(m.lastReason, .interruption)
    }
    // S4b — 사용자 일시정지 중에는 합성 ended 로도 풀리지 않는다
    func testSyntheticEndedKeepsUserPause() {
        var m = RecorderStateMachine(); m.apply(.start); m.apply(.pause)
        m.apply(.interruptionBegan); m.apply(.interruptionEnded)
        XCTAssertEqual(m.state, .paused)
    }
    // 마이크 꺼짐 상태에서 인터럽션 후 복귀하면 micOff 로 돌아간다
    func testSyntheticEndedReturnsToMicOff() {
        var m = RecorderStateMachine(); m.apply(.start); m.apply(.micEnabled(false))
        m.apply(.interruptionBegan); m.apply(.interruptionEnded)
        XCTAssertEqual(m.state, .micOff)
    }
}
