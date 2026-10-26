import Foundation
@testable import AudioRecorderKit

func tempDir() -> URL {
    let u = FileManager.default.temporaryDirectory.appendingPathComponent("arkit-" + UUID().uuidString)
    try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
    return u
}

/// 사인파 PCM(Int16)
func sine(count: Int, offset: Int = 0, rate: Double = 44100) -> [Int16] {
    (0..<count).map { Int16(8000 * sin(2 * Double.pi * 440 * Double($0 + offset) / rate)) }
}

/// 스크립트된 응답을 차례로 돌려주는 HTTP 가짜. 요청은 기록한다.
final class FakeHTTP: AudioHTTPClient, @unchecked Sendable {
    typealias Responder = (URLRequest) throws -> AudioHTTPResponse
    private let lock = NSLock()
    private(set) var requests: [URLRequest] = []
    var responder: Responder
    init(_ r: @escaping Responder) { responder = r }
    func send(_ req: URLRequest) async throws -> AudioHTTPResponse {
        lock.lock(); requests.append(req); lock.unlock()
        return try responder(req)
    }
    var uploadRequests: [URLRequest] { requests.filter { $0.url?.path.hasSuffix("/audio/chunk") == true } }
    var refreshRequests: [URLRequest] { requests.filter { $0.url?.path.hasSuffix("/auth/refresh") == true } }
}

func ok(_ headers: [String: String] = [:], body: String = "{}") -> AudioHTTPResponse {
    AudioHTTPResponse(status: 200, body: Data(body.utf8), headers: headers)
}
func status(_ s: Int) -> AudioHTTPResponse { AudioHTTPResponse(status: s, body: Data(), headers: [:]) }
