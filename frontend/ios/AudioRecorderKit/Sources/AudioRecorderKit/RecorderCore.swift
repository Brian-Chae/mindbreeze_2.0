import Foundation

/// 캡처(PCM)→분할→인코드→큐→업로드 조율. 오디오 스레드에서 feed 를 호출해도 안전(인코딩은 직렬 큐).
public final class RecorderCore: @unchecked Sendable {
    public let sessionId: String
    private let apiBase: String
    private let queue: ChunkQueue
    private let uploader: ChunkUploader
    private let sampleRate: Double
    private let onEvent: @Sendable (RecorderEvent) -> Void
    private let encodeQueue = DispatchQueue(label: "mb.audiorecorder.encode")
    private let lock = NSLock()

    private var splitter: ChunkSplitter
    private var machine = RecorderStateMachine()
    private var nextIndex: Int
    private let startIndex: Int

    public init(sessionId: String, apiBase: String, startIndex: Int, queue: ChunkQueue, uploader: ChunkUploader,
                sampleRate: Double, chunkSamples: Int, onEvent: @escaping @Sendable (RecorderEvent) -> Void) {
        self.sessionId = sessionId; self.apiBase = apiBase; self.queue = queue; self.uploader = uploader
        self.sampleRate = sampleRate; self.onEvent = onEvent
        self.splitter = ChunkSplitter(chunkSamples: chunkSamples)
        self.nextIndex = startIndex; self.startIndex = startIndex
    }

    public var state: RecorderState { lock.lock(); defer { lock.unlock() }; return machine.state }
    public var isCapturing: Bool { lock.lock(); defer { lock.unlock() }; return machine.isCapturing }

    public func begin() {
        lock.lock(); machine.apply(.start); let s = machine.state; let r = machine.lastReason; lock.unlock()
        persist()
        onEvent(.stateChanged(sessionId: sessionId, state: s, reason: r))
    }

    /// 상태 입력. 캡처가 멈추는 전이(일시정지·마이크오프·인터럽션)에는 잔여 조각을 확정한다.
    public func apply(_ input: RecorderInput) {
        lock.lock()
        let before = machine.state
        let wasCapturing = machine.isCapturing
        machine.apply(input)
        let after = machine.state, reason = machine.lastReason
        var tail: [Int16]? = nil
        var idx = -1
        if wasCapturing && !machine.isCapturing, input != .stopped, let t = splitter.flush() { tail = t; idx = nextIndex; nextIndex += 1 }
        lock.unlock()
        if let t = tail { enqueueEncode(t, index: idx) }
        if after != before { onEvent(.stateChanged(sessionId: sessionId, state: after, reason: reason)) }
    }

    /// PCM 입력. 캡처 중이 아니면 버린다(일시정지·마이크 오프 구간 제외).
    public func feed(_ samples: [Int16]) {
        lock.lock()
        guard machine.isCapturing else { lock.unlock(); return }
        var jobs: [(Int, [Int16])] = []
        for c in splitter.append(samples) { jobs.append((nextIndex, c)); nextIndex += 1 }
        lock.unlock()
        for (i, c) in jobs { enqueueEncode(c, index: i) }
    }

    private func enqueueEncode(_ samples: [Int16], index: Int) {
        encodeQueue.async { [self] in
            let staged = queue.newStagingURL()
            do {
                try AACChunkEncoder.encode(samples: samples, sampleRate: sampleRate, to: staged)
                try queue.commit(staged: staged, sessionId: sessionId, index: index)
            } catch ChunkQueueError.diskFull {
                onEvent(.error(sessionId: sessionId, code: .diskFull, message: "저장 공간 상한(200MB)에 도달해 일시정지합니다.", recoverable: true))
                apply(.pause)
                return
            } catch {
                try? FileManager.default.removeItem(at: staged)
                onEvent(.error(sessionId: sessionId, code: .audioEngineFailed, message: "청크 인코딩 실패", recoverable: true))
                return
            }
            persist(lastConfirmed: index)
            Task { [uploader] in await uploader.drain() }
        }
    }

    private var lastConfirmed = -1
    private func persist(lastConfirmed lc: Int? = nil) {
        lock.lock()
        if let lc = lc { lastConfirmed = max(lastConfirmed, lc) }
        let st = RecorderPersistedState(sessionId: sessionId, apiBase: apiBase, nextIndex: nextIndex, lastConfirmed: lastConfirmed)
        lock.unlock()
        try? queue.saveState(st)
    }

    public func status() -> RecorderStatus {
        lock.lock(); let s = machine.state, n = nextIndex; lock.unlock()
        return RecorderStatus(state: s, sessionId: sessionId, nextChunkIndex: n, uploadedCount: uploader.uploadedCount,
                              pendingCount: queue.pendingCount(sessionId: sessionId), lastUploadedIndex: uploader.lastUploadedIndex)
    }

    /// 정지: 잔여 조각 확정 → 인코드 완료 대기 → timeout 까지 업로드 → 남은 개수 보고.
    public func stop(timeout: TimeInterval) async -> RecorderStopResult {
        lock.lock()
        machine.apply(.stopRequested)
        var tail: [Int16]? = nil, idx = -1
        if let t = splitter.flush() { tail = t; idx = nextIndex; nextIndex += 1 }
        lock.unlock()
        onEvent(.stateChanged(sessionId: sessionId, state: .stopping, reason: .user))
        if let t = tail { enqueueEncode(t, index: idx) }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in encodeQueue.async { c.resume() } }
        persist()

        await withTaskGroup(of: Void.self) { g in
            g.addTask { [uploader] in await uploader.drain() }
            g.addTask { [uploader] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                uploader.cancel()
            }
            await g.next()          // 먼저 끝난 쪽(업로드 완료 또는 timeout)
            uploader.cancel()
            g.cancelAll()
        }
        lock.lock(); machine.apply(.stopped); let last = nextIndex - 1; lock.unlock()
        onEvent(.stateChanged(sessionId: sessionId, state: .stopped, reason: .user))
        return RecorderStopResult(pendingCount: queue.pendingCount(sessionId: sessionId), uploadedCount: uploader.uploadedCount, lastChunkIndex: max(last, startIndex - 1))
    }
}
