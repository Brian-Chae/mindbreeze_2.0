import Foundation
import CryptoKit

/// 앱 네이티브 원시 청크의 결정적 식별자. 같은 입력이면 항상 같은 UUID 라 복구 재생에서도 alias 가 어긋나지 않는다.
public enum RawIds {
    public static func uuid(_ seed: String) -> String {
        var b = [UInt8](SHA256.hash(data: Data(seed.utf8)).prefix(16))
        b[6] = (b[6] & 0x0F) | 0x50; b[8] = (b[8] & 0x3F) | 0x80
        let h = b.map { String(format: "%02x", $0) }.joined()
        let c = Array(h)
        return "\(String(c[0..<8]))-\(String(c[8..<12]))-\(String(c[12..<16]))-\(String(c[16..<20]))-\(String(c[20..<32]))"
    }
    public static func streamId(session: String, sensor: BandSensor) -> String { uuid("mb-raw-stream|\(session)|\(name(sensor))") }
    public static func segmentId(session: String, sensor: BandSensor, ordinal: Int) -> String { uuid("mb-raw-segment|\(session)|\(name(sensor))|\(ordinal)") }
    static func name(_ s: BandSensor) -> String { s == .eeg ? "eeg" : s == .ppg ? "ppg" : "acc" }
}

/// 봉인된 원시 청크 1개(서버 raw presign 메타 + MBRAW002 바이트).
public struct RawChunk { public let alias: String; public let meta: [String: Any]; public let payload: Data; public let sha256: String }

/// 한 센서의 BLE 원문 패킷을 서버 raw-v2(MBRAW002) 청크로 봉인한다(Android RawChunker.kt, 웹 capture-session.ts 와 같은 계약).
/// 청크: 10초 분량 샘플 또는 900,000B 중 먼저 / segment 전환 / flush. 패킷은 쪼개지 않고, 길이가 안 맞는 패킷은 샘플 0 으로 바이트만 보존한다.
public final class RawChunker {
    private struct Pkt { let bytes: Data; let rows: Int; let malformed: String?; let tickRaw: UInt64?; let firstSample: Int; let arrivalUs: Int64; let tickUnwrapped: UInt64? }
    public static let chunkSeconds = 10, chunkSoftBytes = 900_000, mapRowEstimate = 260
    /// PPG/ACC tick 은 패킷마다 균일하게 갱신되지 않아 EEG 처럼 2샘플로 자르면 패킷마다 segment 가 쪼개진다.
    public static let ppgAccToleranceUs: Int64 = 500_000
    public static let eegAdcScale = 4.033 / 12 / 8388607 * 1e6, accAdcScale = 2.0 / 32768
    public static let profileId = "mb-native-clock-v1"
    public static let profileHash = Hashing.sha256Hex(Data("{\"profile\":\"\(profileId)\",\"tick_hz\":32768,\"tick_bits\":32,\"endian\":\"little\",\"anchor\":\"last_sample\"}".utf8))

    private let sensor: BandSensor, session: String, originUs: Int64, sink: (RawChunk) -> Void
    private let stride: Int, sampleBytes: Int, rate: Int, toleranceUs: Int64
    private var ordinal: Int, segmentId = "", chunkIndex = 0, nextSample = 0
    private var anchorUs: Int64 = 0, anchorTick: UInt64?, anchorTickUnwrapped: UInt64?
    private var lastTick: UInt64?, lastRaw: UInt64?, wraps: UInt64 = 0
    private var pkts: [Pkt] = [], pktSamples = 0, pktBytes = 0

    public init(sensor: BandSensor, session: String, originUs: Int64, sink: @escaping (RawChunk) -> Void) {
        self.sensor = sensor; self.session = session; self.originUs = originUs; self.sink = sink
        stride = sensor == .eeg ? 17 : sensor == .ppg ? 8 : 18
        sampleBytes = sensor == .eeg ? 7 : 6
        rate = sensor == .eeg ? 250 : sensor == .ppg ? 50 : 30
        toleranceUs = sensor == .eeg ? 2_000_000 / 250 : Self.ppgAccToleranceUs
        ordinal = -1
    }

    public var firstSegmentId: String { RawIds.segmentId(session: session, sensor: sensor, ordinal: 0) }

    public func onPacket(_ bytes: Data, arrivalUs: Int64) {
        guard !bytes.isEmpty else { return }
        let b = [UInt8](bytes)
        let malformed = b.count < 4 + sampleBytes || (b.count - 4) % sampleBytes != 0
        let raw: UInt64? = b.count >= 4 ? UInt64(b[0]) | UInt64(b[1]) << 8 | UInt64(b[2]) << 16 | UInt64(b[3]) << 24 : nil
        let rows = malformed ? 0 : (b.count - 4) / sampleBytes
        var unwrapped: UInt64?
        var roll = segmentId.isEmpty
        if let r = raw {
            if let p = lastRaw, r < p, p - r > 0x8000_0000 { wraps += 1 }
            let u = wraps << 32 + r
            if let pt = lastTick, !roll {
                let elapsed = (Int64(u) - Int64(pt)) * 1_000_000 / 32768
                let expected = Int64(rows) * 1_000_000 / Int64(rate)
                if u < pt || abs(elapsed - expected) > toleranceUs { roll = true }
            }
            unwrapped = u; lastRaw = r; lastTick = u
        }
        if roll { startSegment(arrivalUs: arrivalUs, rows: rows, raw: raw, unwrapped: unwrapped) }
        pkts.append(Pkt(bytes: bytes, rows: rows, malformed: malformed ? "truncated_packet" : nil, tickRaw: raw, firstSample: rows > 0 ? nextSample : -1, arrivalUs: arrivalUs, tickUnwrapped: unwrapped))
        nextSample += rows; pktSamples += rows; pktBytes += bytes.count + rows * stride + Self.mapRowEstimate
        if pktSamples >= Self.chunkSeconds * rate || pktBytes >= Self.chunkSoftBytes { seal() }
    }

    private func startSegment(arrivalUs: Int64, rows: Int, raw: UInt64?, unwrapped: UInt64?) {
        seal()
        ordinal += 1
        segmentId = RawIds.segmentId(session: session, sensor: sensor, ordinal: ordinal)
        chunkIndex = 0; nextSample = 0
        anchorUs = arrivalUs - Int64(max(0, rows - 1)) * 1_000_000 / Int64(rate) // 헤더 tick = 패킷 마지막 샘플 시각
        anchorTick = raw; anchorTickUnwrapped = unwrapped
        wraps = (raw != nil && unwrapped != nil) ? (unwrapped! - raw!) >> 32 : 0
    }

    /// 남은 샘플을 부분 청크로 봉인(정지·종료·segment 전환).
    public func flush() { seal() }

    private static func le<T: FixedWidthInteger>(_ v: T) -> Data { var x = v.littleEndian; return withUnsafeBytes(of: &x) { Data($0) } }
    private static func s24(_ b: [UInt8], _ o: Int) -> Int32 { let v = Int32(b[o]) << 16 | Int32(b[o + 1]) << 8 | Int32(b[o + 2]); return v & 0x800000 != 0 ? v - 0x1000000 : v }
    private static func u24(_ b: [UInt8], _ o: Int) -> UInt32 { UInt32(b[o]) << 16 | UInt32(b[o + 1]) << 8 | UInt32(b[o + 2]) }
    private static func s16(_ b: [UInt8], _ o: Int) -> Int16 { Int16(bitPattern: UInt16(b[o]) | UInt16(b[o + 1]) << 8) }

    private func seal() {
        guard !pkts.isEmpty else { return }
        let samples = pkts.reduce(0) { $0 + $1.rows }
        var sampleData = Data(capacity: samples * stride), packetData = Data(), map = ""
        var offset = 0
        for (i, p) in pkts.enumerated() {
            let b = [UInt8](p.bytes)
            for r in 0..<p.rows {
                let o = 4 + r * sampleBytes
                switch sensor {
                case .eeg:
                    let a = Self.s24(b, o + 1), c = Self.s24(b, o + 4)
                    sampleData += Self.le(a) + Self.le(c) + Data([b[o]]) + Self.le(Float(Double(a) * Self.eegAdcScale).bitPattern) + Self.le(Float(Double(c) * Self.eegAdcScale).bitPattern)
                case .ppg: sampleData += Self.le(Self.u24(b, o)) + Self.le(Self.u24(b, o + 3))
                case .acc:
                    let x = Self.s16(b, o), y = Self.s16(b, o + 2), z = Self.s16(b, o + 4)
                    sampleData += Self.le(x) + Self.le(y) + Self.le(z)
                    for v in [x, y, z] { sampleData += Self.le(Float(Double(v) * Self.accAdcScale).bitPattern) }
                }
            }
            packetData.append(p.bytes)
            let row: [String: Any] = ["packet_seq": i, "byte_offset": offset, "byte_length": p.bytes.count, "first_sample_index": p.rows > 0 ? p.firstSample as Any : NSNull(),
                "sample_count": p.rows, "tick_raw": p.tickRaw.map { String($0) as Any } ?? NSNull(), "tick_unwrapped": p.tickUnwrapped.map { String($0) as Any } ?? NSNull(),
                "received_utc_us": String(p.arrivalUs), "received_monotonic_us": String(p.arrivalUs), "header_anchor": "last_sample", "clock_segment_id": segmentId,
                "malformed_reason": p.malformed.map { $0 as Any } ?? NSNull()]
            map += String(data: try! JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]), encoding: .utf8)! + "\n"
            offset += p.bytes.count
        }
        let mapData = Data(map.utf8)
        let firstIndex = pkts.first { $0.rows > 0 }?.firstSample ?? nextSample
        let enc = sensor == .eeg ? "eeg-i32-i32-u8-f32-f32-le" : sensor == .ppg ? "ppg-u32-u32-le" : "acc-i16-i16-i16-f32-f32-f32-le"
        func sec(_ n: String, _ o: Int, _ l: Int, _ s: Int, _ e: String) -> [String: Any] { ["name": n, "offset": o, "length": l, "row_stride": s, "encoding": e] }
        let streamId = RawIds.streamId(session: session, sensor: sensor)
        let channels = sensor == .eeg ? ["fp1", "fp2"] : sensor == .ppg ? ["red", "ir"] : ["x", "y", "z"]
        let units = sensor == .eeg ? ["uV", "uV"] : sensor == .ppg ? ["ADC_count", "ADC_count"] : ["g", "g", "g"]
        let scale: [Double] = sensor == .eeg ? [Self.eegAdcScale, Self.eegAdcScale] : sensor == .ppg ? [1, 1] : [Self.accAdcScale, Self.accAdcScale, Self.accAdcScale]
        let header: [String: Any] = [
            "schema_version": "mb-biosignal-raw-v2", "signal_type": RawIds.name(sensor), "stream_id": streamId, "segment_id": segmentId, "chunk_index": chunkIndex,
            "parser_profile": ["firmware": "unknown", "device_model": "LINK-BAND-2.0", "profile_id": Self.profileId, "version": "1", "parameters_hash": Self.profileHash,
                               "platform": "native-candidate", "verification": "unverified", "packet_endian": "little", "tick_hz": 32768, "tick_bits": 32, "header_anchor": "last_sample"],
            "rate": ["numerator": rate, "denominator": 1], "observed_rate": NSNull(), "observed_rate_window_us": NSNull(), "observed_rate_reason": "not_measured",
            "channels": channels, "units": units, "scale": scale, "sample_count": samples, "packet_count": pkts.count, "first_sample_index": firstIndex,
            "end_sample_index_exclusive": firstIndex + samples, "time_basis": "host_estimated",
            "anchor": ["sample_index": 0, "utc_us": String(anchorUs), "monotonic_us": String(anchorUs), "relative_us": String(anchorUs - originUs),
                       "device_tick_raw": anchorTick.map { String($0) as Any } ?? NSNull(), "device_tick_unwrapped": anchorTickUnwrapped.map { String($0) as Any } ?? NSNull(),
                       "clock_segment_id": segmentId, "uncertainty_us": NSNull(), "rule": "anchor_plus_index_delta_over_rate"],
            "sections": [sec("samples", 0, sampleData.count, stride, enc), sec("packets", sampleData.count, offset, 0, "bytes"), sec("packet_map", sampleData.count + offset, mapData.count, 0, "utf8-jsonl")],
        ]
        let headerData = try! JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])
        var payload = Data("MBRAW002".utf8); payload += Self.le(UInt32(headerData.count)); payload += headerData; payload += sampleData; payload += packetData; payload += mapData
        let sha = Hashing.sha256Hex(payload)
        let alias = "RAW-\(RawIds.name(sensor).uppercased())-\(String(streamId.replacingOccurrences(of: "-", with: "").prefix(8)))-\(String(segmentId.replacingOccurrences(of: "-", with: "").prefix(8)))-\(String(format: "%06d", chunkIndex))"
        let meta: [String: Any] = ["chunk_alias": alias, "header": header, "checksum": sha, "size_bytes": payload.count, "content_type": "application/octet-stream"]
        pkts.removeAll(); pktSamples = 0; pktBytes = 0; chunkIndex += 1
        sink(RawChunk(alias: alias, meta: meta, payload: payload, sha256: sha))
    }
}
