import XCTest
import AVFoundation
@testable import AudioRecorderKit

final class SplitterEncoderTests: XCTestCase {
    // I1 — 44.1kHz PCM 을 5초 단위로 분할, 경계 샘플 유실·중복 0
    func testSplitterBoundariesNoLossNoDup() {
        var sp = ChunkSplitter(chunkSamples: 220_500)
        let all = sine(count: 220_500 * 2 + 12_345)
        var out: [[Int16]] = []
        var i = 0
        let sizes = [1, 4096, 4097, 99_999, 7]            // 불규칙한 입력 단위
        var k = 0
        while i < all.count {
            let n = min(sizes[k % sizes.count], all.count - i); k += 1
            out += sp.append(Array(all[i..<(i + n)])); i += n
        }
        XCTAssertEqual(out.count, 2)
        XCTAssertTrue(out.allSatisfy { $0.count == 220_500 })
        let rest = sp.flush()
        XCTAssertEqual(rest?.count, 12_345)
        XCTAssertEqual(out.flatMap { $0 } + (rest ?? []), all)
        XCTAssertNil(sp.flush())
    }

    // I2 — PCM → m4a, ftyp 매직, 5.0±0.1s, AVAudioFile 로 독립 재생(open)
    func testEncoderProducesIndependentM4A() throws {
        let url = tempDir().appendingPathComponent("c.m4a")
        try AACChunkEncoder.encode(samples: sine(count: 220_500), sampleRate: 44_100, to: url)
        let d = try Data(contentsOf: url)
        XCTAssertGreaterThan(d.count, 1000)
        XCTAssertEqual(String(data: d.subdata(in: 4..<8), encoding: .ascii), "ftyp")
        let f = try AVAudioFile(forReading: url)
        let secs = Double(f.length) / f.processingFormat.sampleRate
        XCTAssertEqual(secs, 5.0, accuracy: 0.1)
        XCTAssertEqual(f.processingFormat.channelCount, 1)
        XCTAssertEqual(f.processingFormat.sampleRate, 44_100, accuracy: 1)
    }
}
