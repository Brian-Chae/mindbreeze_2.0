import Foundation

public enum JournalError: Error, Equatable {
    case openFailed(Int32), writeFailed(Int32), syncFailed(Int32), closed, payloadTooLarge
}

/// append-only 레코드 파일. 레코드마다 write 후 fsync(F_FULLFSYNC) 한 뒤에만 시퀀스를 돌려준다(ACK 전 메모리만 보관한 창은 완료가 아니다).
///
/// 레코드: magic(4,"MBJ1") | sequence u64 LE | length u32 LE | crc32 u32 LE (sequence+length+payload) | payload  → 헤더 20바이트.
/// 복구(열 때): 처음부터 검증하며 완결 prefix 만 유지한다.
///  - 끝의 불완전 레코드(찢긴 꼬리: 헤더/페이로드 중간에 중단) → 아직 commit 되지 않은 것이므로 잘라내고 이어쓴다.
///  - 완결 길이인데 magic/CRC 불일치(중간 손상) → 그 지점부터 EOF 를 `<file>.corrupt-<ms>` 로 **보존**하고 잘라낸다(조용히 삭제 금지).
public final class AppendOnlyJournal {
    public static let headerSize = 20
    public static let maxPayload = 8 * 1024 * 1024
    static let magic: UInt32 = 0x314A_424D  // "MBJ1" little endian

    public struct Record: Equatable { public let sequence: UInt64; public let payload: Data }
    public struct ScanResult { public let records: [Record]; public let discardedBytes: UInt64; public let corrupt: Bool }

    public let url: URL
    public private(set) var lastSequence: UInt64 = 0
    public private(set) var quarantinedBytes: UInt64 = 0
    public private(set) var tornBytes: UInt64 = 0
    public private(set) var byteSize: UInt64 = 0
    public var syncHook: (() -> Void)?
    private var fd: Int32 = -1
    private let lock = NSLock()

    public init(url: URL, syncHook: (() -> Void)? = nil) throws {
        self.url = url
        self.syncHook = syncHook
        let fd = open(url.path, O_RDWR | O_CREAT, 0o600)
        guard fd >= 0 else { throw JournalError.openFailed(errno) }
        self.fd = fd
        try recover()
        // 백업 제외·보호 등급은 호출자(저장소 디렉터리)가 설정한다.
    }

    deinit { close() }

    public func close() {
        lock.lock(); defer { lock.unlock() }
        if fd >= 0 { Darwin.close(fd); fd = -1 }
    }

    // MARK: 읽기(순수)

    private enum WalkEnd { case clean, torn(at: Int), corrupt(at: Int) }

    private static func u32(_ d: Data, _ o: Int) -> UInt32 { (0..<4).reduce(0) { $0 | (UInt32(d[d.startIndex + o + $1]) << (8 * UInt32($1))) } }
    private static func u64(_ d: Data, _ o: Int) -> UInt64 { (0..<8).reduce(0) { $0 | (UInt64(d[d.startIndex + o + $1]) << (8 * UInt64($1))) } }

    private static func walk(_ data: Data, visit: (UInt64, Data) -> Void) -> WalkEnd {
        var off = 0
        while off < data.count {
            let remaining = data.count - off
            if remaining < headerSize { return .torn(at: off) }
            let head = data.subdata(in: (data.startIndex + off)..<(data.startIndex + off + headerSize))
            if u32(head, 0) != magic { return .corrupt(at: off) }
            let seq = u64(head, 4), len = Int(u32(head, 12)), crc = u32(head, 16)
            if len > maxPayload { return .corrupt(at: off) }
            if remaining < headerSize + len { return .torn(at: off) }
            let payload = data.subdata(in: (data.startIndex + off + headerSize)..<(data.startIndex + off + headerSize + len))
            var covered = head.subdata(in: 4..<16); covered.append(payload)
            if CRC32.checksum(covered) != crc { return .corrupt(at: off) }
            visit(seq, payload)
            off += headerSize + len
        }
        return .clean
    }

    /// 파일을 수정하지 않고 완결 prefix 를 읽는다.
    public static func scan(url: URL) -> ScanResult {
        guard let data = try? Data(contentsOf: url) else { return ScanResult(records: [], discardedBytes: 0, corrupt: false) }
        var recs: [Record] = []
        let end = walk(data) { recs.append(Record(sequence: $0, payload: $1)) }
        switch end {
        case .clean: return ScanResult(records: recs, discardedBytes: 0, corrupt: false)
        case .torn(let at): return ScanResult(records: recs, discardedBytes: UInt64(data.count - at), corrupt: false)
        case .corrupt(let at): return ScanResult(records: recs, discardedBytes: UInt64(data.count - at), corrupt: true)
        }
    }

    // MARK: 복구·쓰기

    private func recover() throws {
        let data = (try? Data(contentsOf: url)) ?? Data()
        var last: UInt64 = 0
        let end = Self.walk(data) { seq, _ in last = seq }
        var validEnd = data.count
        switch end {
        case .clean: break
        case .torn(let at):
            validEnd = at; tornBytes = UInt64(data.count - at)
            ftruncate(fd, off_t(at))
            try fullSync()
        case .corrupt(let at):
            validEnd = at; quarantinedBytes = UInt64(data.count - at)
            let side = url.deletingLastPathComponent().appendingPathComponent("\(url.lastPathComponent).corrupt-\(Int(Date().timeIntervalSince1970 * 1000))")
            try data.subdata(in: (data.startIndex + at)..<data.endIndex).write(to: side, options: .atomic)
            ftruncate(fd, off_t(at))
            try fullSync()
        }
        lastSequence = last
        byteSize = UInt64(validEnd)
        lseek(fd, 0, SEEK_END)
    }

    private func fullSync() throws {
        if fcntl(fd, F_FULLFSYNC) != 0 {
            if fsync(fd) != 0 { throw JournalError.syncFailed(errno) }
        }
    }

    /// 레코드를 쓰고 fsync 까지 끝난 뒤 시퀀스를 반환한다.
    @discardableResult
    public func append(_ payload: Data) throws -> UInt64 {
        lock.lock(); defer { lock.unlock() }
        guard fd >= 0 else { throw JournalError.closed }
        guard payload.count <= Self.maxPayload else { throw JournalError.payloadTooLarge }
        let seq = lastSequence + 1
        var body = Data(); var s = seq.littleEndian; var l = UInt32(payload.count).littleEndian
        withUnsafeBytes(of: &s) { body.append(contentsOf: $0) }
        withUnsafeBytes(of: &l) { body.append(contentsOf: $0) }
        body.append(payload)
        var rec = Data(); var m = Self.magic.littleEndian; var c = CRC32.checksum(body).littleEndian
        withUnsafeBytes(of: &m) { rec.append(contentsOf: $0) }
        rec.append(body.prefix(12))
        withUnsafeBytes(of: &c) { rec.append(contentsOf: $0) }
        rec.append(payload)
        try rec.withUnsafeBytes { (buf: UnsafeRawBufferPointer) in
            var written = 0
            while written < buf.count {
                let n = Darwin.write(fd, buf.baseAddress!.advanced(by: written), buf.count - written)
                if n < 0 { if errno == EINTR { continue }; throw JournalError.writeFailed(errno) }
                written += n
            }
        }
        try fullSync()
        syncHook?()
        lastSequence = seq
        byteSize += UInt64(rec.count)
        return seq
    }
}
