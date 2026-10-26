import Foundation

/// 연속 PCM 을 고정 길이(샘플 수) 청크로 분할한다. 경계 샘플 유실·중복 없음.
public struct ChunkSplitter {
    public let chunkSamples: Int
    private var buf: [Int16] = []
    public init(chunkSamples: Int) { precondition(chunkSamples > 0); self.chunkSamples = chunkSamples }

    public mutating func append(_ samples: [Int16]) -> [[Int16]] {
        buf.append(contentsOf: samples)
        var out: [[Int16]] = []
        while buf.count >= chunkSamples {
            out.append(Array(buf[0..<chunkSamples]))
            buf.removeFirst(chunkSamples)
        }
        return out
    }
    /// 잔여 조각을 확정한다(없으면 nil).
    public mutating func flush() -> [Int16]? {
        guard !buf.isEmpty else { return nil }
        defer { buf.removeAll(keepingCapacity: true) }
        return buf
    }
    public var buffered: Int { buf.count }
}
