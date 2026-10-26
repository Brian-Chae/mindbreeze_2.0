import XCTest
@testable import AudioRecorderKit

final class StateMachineTests: XCTestCase {
    // I5 — 상태기계: pause/resume/micOff 규칙, 인터럽션 시작→paused, 종료→재개
    func testPauseResume() {
        var m = RecorderStateMachine()
        m.apply(.start); XCTAssertEqual(m.state, .recording); XCTAssertTrue(m.isCapturing)
        m.apply(.pause); XCTAssertEqual(m.state, .paused); XCTAssertFalse(m.isCapturing)
        m.apply(.resume); XCTAssertEqual(m.state, .recording)
    }
    func testMicOff() {
        var m = RecorderStateMachine(); m.apply(.start)
        m.apply(.micEnabled(false)); XCTAssertEqual(m.state, .micOff); XCTAssertFalse(m.isCapturing)
        m.apply(.micEnabled(true)); XCTAssertEqual(m.state, .recording)
    }
    func testPausedStaysPausedWhenMicToggles() {
        var m = RecorderStateMachine(); m.apply(.start); m.apply(.pause)
        m.apply(.micEnabled(false)); XCTAssertEqual(m.state, .paused)
        m.apply(.resume); XCTAssertEqual(m.state, .micOff)
    }
    func testInterruptionPausesAndResumes() {
        var m = RecorderStateMachine(); m.apply(.start)
        m.apply(.interruptionBegan); XCTAssertEqual(m.state, .paused); XCTAssertEqual(m.lastReason, .interruption)
        m.apply(.interruptionEnded); XCTAssertEqual(m.state, .recording)
    }
    func testInterruptionEndDoesNotOverrideUserPause() {
        var m = RecorderStateMachine(); m.apply(.start); m.apply(.pause)
        m.apply(.interruptionBegan); m.apply(.interruptionEnded)
        XCTAssertEqual(m.state, .paused)
    }
    func testStop() {
        var m = RecorderStateMachine(); m.apply(.start); m.apply(.stopRequested)
        XCTAssertEqual(m.state, .stopping); m.apply(.stopped); XCTAssertEqual(m.state, .stopped)
        m.apply(.resume); XCTAssertEqual(m.state, .stopped)   // 종료 후엔 무시
    }
}
