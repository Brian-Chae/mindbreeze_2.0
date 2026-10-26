import Foundation

/// 기기 시트 미리보기용 최근 원시 샘플 링버퍼(EEG 250Hz·PPG 50Hz). 수치만 담는다 — 원문 바이트·토큰 없음. Android RawPreviewBuffer.kt 와 같은 응답 형태.
public final class RawPreviewBuffer {
    public struct Preview: Equatable {
        public let eegFp1: [Double], eegFp2: [Double], ppgRed: [Double], ppgIr: [Double]
        public var dictionary: [String: Any] { ["eegFp1": eegFp1, "eegFp2": eegFp2, "ppgRed": ppgRed, "ppgIr": ppgIr] }
    }
    public static let eegUvScale = 4.033 / 12 / 8388607 * 1e6

    private let eegCapacity: Int, ppgCapacity: Int
    private var fp1: [Double] = [], fp2: [Double] = [], red: [Double] = [], ir: [Double] = []
    private let lock = NSLock()

    public init(eegCapacity: Int = 1000, ppgCapacity: Int = 200) { self.eegCapacity = eegCapacity; self.ppgCapacity = ppgCapacity }

    public func addEeg(ch1: [Double], ch2: [Double]) {
        lock.lock(); defer { lock.unlock() }
        fp1 += ch1; fp2 += ch2
        if fp1.count > eegCapacity { let n = fp1.count - eegCapacity; fp1.removeFirst(n); fp2.removeFirst(min(n, fp2.count)) }
    }
    public func addPpg(red r: [Double], ir i: [Double]) {
        lock.lock(); defer { lock.unlock() }
        red += r; ir += i
        if red.count > ppgCapacity { let n = red.count - ppgCapacity; red.removeFirst(n); ir.removeFirst(min(n, ir.count)) }
    }

    /// 원시 BLE 패킷(헤더 uint32 LE + 샘플)을 파싱해 채운다. 형식이 맞지 않으면 무시(미리보기만 영향).
    public func add(sensor: BandSensor, bytes d: Data) {
        let b = [UInt8](d)
        func u24(_ o: Int) -> Int { Int(b[o]) << 16 | Int(b[o + 1]) << 8 | Int(b[o + 2]) }
        func s24(_ o: Int) -> Int { let v = u24(o); return v & 0x800000 != 0 ? v - 0x1000000 : v }
        switch sensor {
        case .eeg:
            guard b.count >= 8 else { return }
            let n = (b.count - 4) / 7
            var c1 = [Double](), c2 = [Double]()
            for i in 0..<n { let o = 4 + i * 7; c1.append(Double(s24(o + 1)) * Self.eegUvScale); c2.append(Double(s24(o + 4)) * Self.eegUvScale) }
            addEeg(ch1: c1, ch2: c2)
        case .ppg:
            guard b.count >= 8 else { return }
            let n = (b.count - 4) / 6
            var r = [Double](), i2 = [Double]()
            for i in 0..<n { let o = 4 + i * 6; r.append(Double(u24(o))); i2.append(Double(u24(o + 3))) }
            addPpg(red: r, ir: i2)
        case .acc: break
        }
    }

    public func preview(points: Int) -> Preview {
        lock.lock(); defer { lock.unlock() }
        return Preview(eegFp1: Self.down(fp1, points), eegFp2: Self.down(fp2, points), ppgRed: Self.down(red, points), ppgIr: Self.down(ir, points))
    }

    /// 처음·끝을 유지하는 균등 추출
    static func down(_ src: [Double], _ count: Int) -> [Double] {
        let n = src.count
        if n == 0 { return [] }
        if n <= count { return src }
        if count < 2 { return [src[n - 1]] }
        let last = Double(n - 1)
        return (0..<count).map { i in src[Int((Double(i) * last / Double(count - 1)).rounded())] }
    }
}
