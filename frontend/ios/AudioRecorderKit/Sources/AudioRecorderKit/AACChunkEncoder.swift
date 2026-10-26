import Foundation
import AVFoundation

public enum AACChunkEncoderError: Error { case formatUnavailable, bufferAllocation }

/// PCM(Int16 mono) → AAC-LC m4a(mono, 64kbps) 독립 파일.
public enum AACChunkEncoder {
    public static let bitRate = 64_000

    public static func encode(samples: [Int16], sampleRate: Double, to url: URL) throws {
        guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false) else {
            throw AACChunkEncoderError.formatUnavailable
        }
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(samples.count)),
              let ch = buf.floatChannelData?[0] else { throw AACChunkEncoderError.bufferAllocation }
        buf.frameLength = AVAudioFrameCount(samples.count)
        for i in 0..<samples.count { ch[i] = Float(samples[i]) / 32768.0 }
        try? FileManager.default.removeItem(at: url)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: bitRate,
        ]
        do {   // 스코프 종료 시 AVAudioFile 이 닫히며 파일이 확정된다
            let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
            try file.write(from: buf)
        }
    }
}
