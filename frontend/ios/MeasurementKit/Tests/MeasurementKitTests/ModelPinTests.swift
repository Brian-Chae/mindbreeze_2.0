import XCTest
@testable import MeasurementKit

final class ModelPinTests: XCTestCase {
    let model = #"{"focusIndex":{"m":-1.2,"s":0.5,"direction":1},"relaxationIndex":{"m":-0.3,"s":0.4,"direction":"-1"},"emotionalStability":{"m":3.5,"s":0.8,"direction":1},"totalNeuralActivity":{"m":2.3252,"s":2.3342,"direction":1}}"#
    var tmp: URL!
    override func setUpWithError() throws { tmp = FileManager.default.temporaryDirectory.appendingPathComponent("pin-\(UUID().uuidString)") }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: tmp) }

    func testA1BuildProducesActiveSigmoidConfigAndValidVersion() throws {
        let pin = try XCTUnwrap(ModelPin.build(rawParams: model, version: "t 1/2"))
        XCTAssertEqual(pin.modelHash.count, 64); XCTAssertNotNil(pin.modelHash.range(of: "^[0-9a-f]{64}$", options: .regularExpression))
        XCTAssertNotNil(pin.modelVersion.range(of: "^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$", options: .regularExpression))
        XCTAssertEqual(pin.modelVersion, "sigmoid-t12")
        let cfg = try JSONSerialization.jsonObject(with: Data(ModelPin.configJSON(pin).utf8)) as! [String: Any]
        XCTAssertEqual(cfg["model_mode"] as? String, "active_sigmoid"); XCTAssertEqual(cfg["model_hash"] as? String, pin.modelHash)
        XCTAssertEqual(cfg["model_version"] as? String, pin.modelVersion)
    }
    func testA2HashIsKeyOrderIndependent() throws {
        let reordered = #"{"totalNeuralActivity":{"m":2.3252,"s":2.3342,"direction":1},"emotionalStability":{"m":3.5,"s":0.8,"direction":1},"relaxationIndex":{"direction":-1,"s":0.4,"m":-0.3},"focusIndex":{"direction":1,"s":0.5,"m":-1.2}}"#
        XCTAssertEqual(ModelPin.build(rawParams: model, version: "a")?.modelHash, ModelPin.build(rawParams: reordered, version: "a")?.modelHash)
        XCTAssertNotEqual(ModelPin.build(rawParams: model, version: "a")?.modelHash, ModelPin.build(rawParams: model.replacingOccurrences(of: "0.5", with: "0.6"), version: "a")?.modelHash)
    }
    func testA3InvalidMetricsDroppedAndAllInvalidIsNil() {
        let mixed = #"{"focusIndex":{"m":1,"s":0,"direction":1},"stressIndex":{"m":1,"s":1,"direction":2},"sdnn":{"m":1,"s":1,"direction":1},"unknown":{"m":1,"s":1,"direction":1}}"#
        XCTAssertEqual(ModelPin.build(rawParams: mixed, version: "x")?.paramsJSON.contains("sdnn"), true)
        XCTAssertEqual(ModelPin.build(rawParams: mixed, version: "x")?.paramsJSON.contains("focusIndex"), false)
        XCTAssertNil(ModelPin.build(rawParams: #"{"focusIndex":{"m":1,"s":-1,"direction":1}}"#, version: "x"))
        XCTAssertNil(ModelPin.build(rawParams: "", version: "x")); XCTAssertNil(ModelPin.build(rawParams: nil, version: "x")); XCTAssertNil(ModelPin.build(rawParams: "not json", version: "x"))
    }
    func testA4PinsOnceAndCorruptFileIsRewritten() throws {
        let f = tmp.appendingPathComponent("model-pin.json")
        let first = try XCTUnwrap(ModelPin.loadOrCreate(file: f, rawParams: model, version: "v1"))
        let other = model.replacingOccurrences(of: "2.3342", with: "9.9")
        let second = ModelPin.loadOrCreate(file: f, rawParams: other, version: "v2")
        XCTAssertEqual(second, first, "파일이 있으면 새 입력을 무시")
        XCTAssertEqual(ModelPin.loadOrCreate(file: f, rawParams: nil, version: nil), first, "복구 경로(입력 없음)도 파일에서 읽는다")
        try Data("{broken".utf8).write(to: f)
        let third = try XCTUnwrap(ModelPin.loadOrCreate(file: f, rawParams: other, version: "v2"))
        XCTAssertEqual(third.modelVersion, "sigmoid-v2")
        XCTAssertNil(ModelPin.loadOrCreate(file: tmp.appendingPathComponent("none.json"), rawParams: nil, version: nil))
    }
    func testA5NoPinKeepsLegacyConfig() {
        XCTAssertEqual(ModelPin.configJSON(nil), ModelPin.defaultConfig)
        XCTAssertEqual(ModelPin.defaultConfig.trimmingCharacters(in: .whitespacesAndNewlines), CoreBridgeTests.cfg.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // A6: 엔진 — 모델 pin 시 이완도 display 가 valid, 코호트에서는 pending. raw 는 모델과 무관.
    func runEngine(_ pin: ModelPin?, _ name: String) throws -> [[String: Any]] {
        let d = tmp.appendingPathComponent(name); try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        let e = try MeasurementEngine(dir: d, configJSON: ModelPin.configJSON(pin), context: EngineTests.ctx, journalSync: .none, modelParamsJSON: pin?.paramsJSON)
        for p in EngineTests.packets { try e.ingest(sensor: p.sensor, bytes: p.bytes, arrivalMonotonicUs: p.arrivalUs, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0) }
        return AppendOnlyJournal.scan(url: d.appendingPathComponent("feature.journal")).records.compactMap { try? JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }
    }
    func disp(_ f: [String: Any], _ k: String) -> Double? {
        guard let m = (f["metrics"] as? [String: Any])?[k] as? [String: Any], m["validity"] as? String == "valid" else { return nil }
        return (m["value"] as? NSNumber)?.doubleValue
    }
    func testA6PinnedModelMakesRelaxationDisplayValidAndRawUnchanged() throws {
        let cohort = try runEngine(nil, "c"), pinned = try runEngine(ModelPin.build(rawParams: model, version: "t1"), "m")
        XCTAssertFalse(cohort.isEmpty)
        XCTAssertTrue(cohort.compactMap { disp($0, "relaxation_display") }.isEmpty, "코호트: 이완도 display pending")
        XCTAssertFalse(pinned.compactMap { disp($0, "relaxation_display") }.isEmpty, "pin: display valid")
        XCTAssertEqual(cohort.compactMap { disp($0, "focus_raw") }, pinned.compactMap { disp($0, "focus_raw") })
        XCTAssertEqual(pinned.first?["model_version"] as? String, "sigmoid-t1")
        XCTAssertEqual(cohort.first?["model_version"] as? String, "b0-cohort-2")
    }
    func testA6bPinSurvivesEngineRestartWithSameModel() throws {
        let pin = ModelPin.build(rawParams: model, version: "t1")
        let d = tmp.appendingPathComponent("r"); try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        let mk = { try MeasurementEngine(dir: d, configJSON: ModelPin.configJSON(pin), context: EngineTests.ctx, checkpointEveryPackets: 200, journalSync: .none, modelParamsJSON: pin?.paramsJSON) }
        let e1 = try mk()
        for p in EngineTests.packets.prefix(1500) { try e1.ingest(sensor: p.sensor, bytes: p.bytes, arrivalMonotonicUs: p.arrivalUs, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0) }
        e1.abandon()
        let e2 = try mk()
        for p in EngineTests.packets.dropFirst(1500) { try e2.ingest(sensor: p.sensor, bytes: p.bytes, arrivalMonotonicUs: p.arrivalUs, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0) }
        let restarted = AppendOnlyJournal.scan(url: d.appendingPathComponent("feature.journal")).records.compactMap { try? JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }
        let straight = try runEngine(pin, "s")
        XCTAssertEqual(restarted.map { $0["feature_hash"] as? String }, straight.map { $0["feature_hash"] as? String })
    }
}

final class RawPreviewTests: XCTestCase {
    func eegPacket(_ n: Int, value: Int) -> Data {
        var d = Data([0, 0, 0, 0])
        for _ in 0..<n { d.append(0); for _ in 0..<2 { d.append(contentsOf: [UInt8((value >> 16) & 0xff), UInt8((value >> 8) & 0xff), UInt8(value & 0xff)]) } }
        return d
    }
    func ppgPacket(_ n: Int, red: Int, ir: Int) -> Data {
        var d = Data([0, 0, 0, 0])
        for _ in 0..<n { for v in [red, ir] { d.append(contentsOf: [UInt8((v >> 16) & 0xff), UInt8((v >> 8) & 0xff), UInt8(v & 0xff)]) } }
        return d
    }
    func testB1CapacityDropsOldestAndEmptyIsEmpty() {
        let b = RawPreviewBuffer()
        XCTAssertEqual(b.preview(points: 10), RawPreviewBuffer.Preview(eegFp1: [], eegFp2: [], ppgRed: [], ppgIr: []))
        b.addEeg(ch1: (0..<1500).map(Double.init), ch2: (0..<1500).map(Double.init))
        b.addPpg(red: (0..<300).map(Double.init), ir: (0..<300).map(Double.init))
        let all = b.preview(points: 5000)
        XCTAssertEqual(all.eegFp1.count, 1000); XCTAssertEqual(all.eegFp1.first, 500); XCTAssertEqual(all.eegFp1.last, 1499)
        XCTAssertEqual(all.ppgRed.count, 200); XCTAssertEqual(all.ppgRed.first, 100)
    }
    func testB1DownsampleKeepsFirstAndLast() {
        let b = RawPreviewBuffer(); b.addEeg(ch1: (0..<1000).map(Double.init), ch2: (0..<1000).map(Double.init))
        let p = b.preview(points: 120)
        XCTAssertEqual(p.eegFp1.count, 120); XCTAssertEqual(p.eegFp1.first, 0); XCTAssertEqual(p.eegFp1.last, 999)
        XCTAssertEqual(RawPreviewBuffer.down([1, 2, 3], 1), [3])
    }
    func testB2ParsesRawPacketsWithAndroidScale() {
        let b = RawPreviewBuffer()
        b.add(sensor: .eeg, bytes: eegPacket(3, value: 8388607 / 2)); b.add(sensor: .ppg, bytes: ppgPacket(2, red: 1000, ir: 2000)); b.add(sensor: .acc, bytes: Data(repeating: 1, count: 40)); b.add(sensor: .eeg, bytes: Data([1, 2]))
        let p = b.preview(points: 10)
        XCTAssertEqual(p.eegFp1.count, 3); XCTAssertEqual(p.eegFp1[0], Double(8388607 / 2) * 4.033 / 12 / 8388607 * 1e6, accuracy: 1e-9)
        XCTAssertEqual(p.ppgRed, [1000, 1000]); XCTAssertEqual(p.ppgIr, [2000, 2000])
        XCTAssertEqual(Set(p.dictionary.keys), ["eegFp1", "eegFp2", "ppgRed", "ppgIr"])
        // 음수(부호 확장)
        let n = RawPreviewBuffer(); n.add(sensor: .eeg, bytes: eegPacket(1, value: 0xFFFFFF)); XCTAssertLessThan(n.preview(points: 2).eegFp1[0], 0)
    }
    func testB2EngineIngestFillsPreview() throws {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent("rp-\(UUID().uuidString)"); try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: d) }
        let e = try MeasurementEngine(dir: d, configJSON: CoreBridgeTests.cfg, context: EngineTests.ctx, journalSync: .none)
        for p in EngineTests.packets.prefix(300) { try e.ingest(sensor: p.sensor, bytes: p.bytes, arrivalMonotonicUs: p.arrivalUs, wallMs: 1_760_000_000_000, anchorMonotonicUs: 0) }
        let pv = e.rawPreview.preview(points: 120)
        XCTAssertEqual(pv.eegFp1.count, 120); XCTAssertEqual(pv.eegFp2.count, 120); XCTAssertFalse(pv.ppgRed.isEmpty)
    }
}
