import XCTest
@testable import MeasurementKit

final class CoreBridgeTests: XCTestCase {
    static let cfg = """
    {"abi_version":1,"device_profile_version":"linkband2-v1","algorithm_version":"web-ts-1","model_version":"b0-cohort-2","model_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","model_mode":"legacy_cohort","rates_hz":{"eeg":250,"ppg":50,"acc":30},"anchor":"last_sample_web_v1","acc_interval_profile":"rounded_33333us_v1"}
    """
    func eegPacket(tick: UInt32, samples: Int = 25, extra: Int = 0) -> Data {
        var d = Data(); var t = tick.littleEndian; withUnsafeBytes(of: &t) { d.append(contentsOf: $0) }
        d.append(Data(repeating: 0, count: samples * 7 + extra)); return d
    }
    func testAbiVersionMatchesContract() { XCTAssertEqual(CoreBridge.abiVersion, 1) }

    func testValidEegPacketAccepted() throws {
        let core = try CoreBridge(configJSON: Self.cfg)
        let out = try core.push(sensor: .eeg, bytes: eegPacket(tick: 32768), arrivalMonotonicUs: 1_000_000, wallMs: 1_760_000_000_000, anchorMonotonicUs: 900_000)
        XCTAssertEqual(out.packetStatus, "accepted")
        XCTAssertEqual(out.samples, 25)
        XCTAssertTrue(out.rawPreserved)
    }
    /// 패킷 경계: 7바이트 단위가 아닌 나머지, 헤더보다 짧은 패킷은 invalid 로 분리하되 원문은 보존한다.
    func testPacketBoundaryRemainderAndShortHeader() throws {
        let core = try CoreBridge(configJSON: Self.cfg)
        let rem = try core.push(sensor: .eeg, bytes: eegPacket(tick: 40000, extra: 3), arrivalMonotonicUs: 1, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0)
        XCTAssertEqual(rem.packetStatus, "invalid_remainder"); XCTAssertTrue(rem.rawPreserved)
        let short = try core.push(sensor: .eeg, bytes: Data([1, 2, 3]), arrivalMonotonicUs: 2, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0)
        XCTAssertEqual(short.packetStatus, "invalid_header_short"); XCTAssertTrue(short.rawPreserved)
        let tooShort = try core.push(sensor: .eeg, bytes: Data([1, 2, 3, 4, 5]), arrivalMonotonicUs: 3, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0)
        XCTAssertTrue(tooShort.packetStatus.hasPrefix("invalid"), tooShort.packetStatus)
    }
    func testDuplicateNotificationDetected() throws {
        let core = try CoreBridge(configJSON: Self.cfg)
        let p = eegPacket(tick: 32768)
        _ = try core.push(sensor: .eeg, bytes: p, arrivalMonotonicUs: 1, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0)
        let dup = try core.push(sensor: .eeg, bytes: p, arrivalMonotonicUs: 2, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0)
        XCTAssertEqual(dup.packetStatus, "duplicate")
    }
    func testInvalidConfigThrowsCoreError() {
        XCTAssertThrowsError(try CoreBridge(configJSON: "{\"abi_version\":2}")) { e in
            guard case CoreBridgeError.core(let code, _) = e else { return XCTFail("\(e)") }
            XCTAssertEqual(code, "invalid_config")
        }
    }
    func testCheckpointRestoreRoundTripAndCorruptRejected() throws {
        let a = try CoreBridge(configJSON: Self.cfg)
        _ = try a.push(sensor: .eeg, bytes: eegPacket(tick: 32768), arrivalMonotonicUs: 1, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0)
        let ck = try a.checkpoint()
        let b = try CoreBridge(configJSON: Self.cfg, restoring: ck)
        let dup = try b.push(sensor: .eeg, bytes: eegPacket(tick: 32768), arrivalMonotonicUs: 5, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0)
        XCTAssertEqual(dup.packetStatus, "duplicate", "복원된 코어는 이전 tick 상태를 기억")
        var bad = ck; bad[bad.count / 2] ^= 0xFF
        XCTAssertThrowsError(try CoreBridge(configJSON: Self.cfg, restoring: bad))
    }
    func testCloseReturnsFinalManifestAndReleasesHandle() throws {
        let core = try CoreBridge(configJSON: Self.cfg)
        _ = try core.push(sensor: .eeg, bytes: eegPacket(tick: 32768), arrivalMonotonicUs: 1, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0)
        let fin = try core.close()
        XCTAssertGreaterThanOrEqual(fin.segments, 1)
        XCTAssertThrowsError(try core.checkpoint())
    }
}
