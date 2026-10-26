import Foundation
import MeasurementCoreFFI

public enum BandSensor: UInt8 { case eeg = 0, ppg = 1, acc = 2 }

public enum CoreBridgeError: Error, Equatable {
    case core(code: String, message: String)
    case closed
    case malformed(String)
}

public struct CoreFrame {
    public let sequence: String
    public let windowStartUs: String
    public let windowEndUs: String
    public let observedAtMs: UInt64
    public let featureHash: String
    /// 계약 MetricFrame JSON 그대로(contact/sqi/metrics 포함). 값을 0 으로 바꾸거나 반올림하지 않는다.
    public let json: [String: Any]
}

public struct CorePushOutput {
    public let packetStatus: String
    public let segment: Int
    public let samples: Int
    public let rawPreserved: Bool
    public let frames: [CoreFrame]
    /// 수락된 패킷의 장치 sample clock 확장 tick(u64 십진 문자열). capture.reanchor 의 device_ticks 로 쓴다.
    public let extendedTicks: String?
}

public struct CoreFinal {
    public let eeg: String, ppg: String, acc: String, metric: String
    public let segments: Int
    public let rawSha256: String, featureSha256: String
}

/// Rust 측정 코어(C ABI) 래퍼. 변환만 담당한다. 결과 버퍼는 mc_buffer_free 로 정확히 한 번 해제한다.
public final class CoreBridge {
    public static var abiVersion: UInt32 { mc_abi_version() }
    private var handle: UInt64 = 0
    private let lock = NSLock()

    public init(configJSON: String, restoring checkpoint: Data? = nil) throws {
        var err = McBuffer(data: nil, len: 0)
        defer { mc_buffer_free(&err) }
        var h: UInt64 = 0
        let cfg = Array(configJSON.utf8)
        let st: Int32
        if let ck = checkpoint {
            let ckb = Array(ck)
            st = cfg.withUnsafeBufferPointer { c in ckb.withUnsafeBufferPointer { k in mc_restore(c.baseAddress, c.count, k.baseAddress, k.count, &h, &err) } }
        } else {
            st = cfg.withUnsafeBufferPointer { c in mc_create(c.baseAddress, c.count, &h, &err) }
        }
        if st != 0 { throw Self.error(st, err) }
        handle = h
    }

    deinit { if handle != 0 { _ = mc_destroy(handle) } }

    private static func text(_ b: McBuffer) -> Data { b.data == nil ? Data() : Data(bytes: b.data, count: b.len) }
    private static func error(_ st: Int32, _ b: McBuffer) -> CoreBridgeError {
        if let o = try? JSONSerialization.jsonObject(with: text(b)) as? [String: Any], let code = o["code"] as? String {
            return .core(code: code, message: (o["message"] as? String) ?? "")
        }
        return .core(code: "status_\(st)", message: "")
    }

    private func call(_ body: (UInt64, inout McBuffer) -> Int32) throws -> Data {
        lock.lock(); defer { lock.unlock() }
        guard handle != 0 else { throw CoreBridgeError.closed }
        var out = McBuffer(data: nil, len: 0)
        defer { mc_buffer_free(&out) }
        let st = body(handle, &out)
        if st != 0 { throw Self.error(st, out) }
        return Self.text(out)
    }

    private static func frame(_ o: [String: Any]) throws -> CoreFrame {
        guard let seq = o["sequence"] as? String, let ws = o["window_start_us"] as? String, let we = o["window_end_us"] as? String,
              let obs = (o["observed_at_ms"] as? NSNumber)?.uint64Value, let fh = o["feature_hash"] as? String
        else { throw CoreBridgeError.malformed("frame") }
        return CoreFrame(sequence: seq, windowStartUs: ws, windowEndUs: we, observedAtMs: obs, featureHash: fh, json: o)
    }

    public func push(sensor: BandSensor, bytes: Data, arrivalMonotonicUs: UInt64, wallMs: UInt64, anchorMonotonicUs: UInt64) throws -> CorePushOutput {
        let arr = Array(bytes)
        let data = try call { h, out in
            arr.withUnsafeBufferPointer { mc_push_packet_raw(h, sensor.rawValue, $0.baseAddress, $0.count, arrivalMonotonicUs, wallMs, anchorMonotonicUs, &out) }
        }
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any], let p = o["packet"] as? [String: Any],
              let status = p["status"] as? String else { throw CoreBridgeError.malformed("push") }
        let frames = try ((o["frames"] as? [[String: Any]]) ?? []).map(Self.frame)
        return CorePushOutput(packetStatus: status, segment: (p["segment"] as? Int) ?? 0, samples: (p["samples"] as? Int) ?? 0,
                              rawPreserved: (p["raw_preserved"] as? Bool) ?? false, frames: frames, extendedTicks: p["extended_ticks"] as? String)
    }

    public func advance(monotonicUs: UInt64) throws -> [CoreFrame] {
        let data = try call { h, out in mc_advance(h, monotonicUs, &out) }
        guard let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { throw CoreBridgeError.malformed("advance") }
        return try arr.map(Self.frame)
    }

    public func setModel(json: String) throws {
        let b = Array(json.utf8)
        _ = try call { h, out in b.withUnsafeBufferPointer { mc_set_model(h, $0.baseAddress, $0.count, &out) } }
    }

    public func checkpoint() throws -> Data { try call { h, out in mc_checkpoint(h, &out) } }

    public func close() throws -> CoreFinal {
        let data = try call { h, out in mc_close(h, &out) }
        lock.lock(); handle = 0; lock.unlock()   // mc_close 성공 시 코어가 핸들을 해제했다
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any], let fs = o["final_sequences"] as? [String: Any],
              let rs = o["raw_sha256"] as? String, let fh = o["feature_sha256"] as? String else { throw CoreBridgeError.malformed("final") }
        func s(_ k: String) -> String { (fs[k] as? String) ?? String(describing: fs[k] ?? "0") }
        return CoreFinal(eeg: s("eeg"), ppg: s("ppg"), acc: s("acc"), metric: s("metric"), segments: (o["segments"] as? Int) ?? 0, rawSha256: rs, featureSha256: fh)
    }

    /// 중단 경로(마감 없이 폐기)
    public func destroy() { lock.lock(); if handle != 0 { _ = mc_destroy(handle); handle = 0 }; lock.unlock() }
}
