import Foundation
import AVFoundation
import UIKit
import AudioRecorderKit

/// AVAudioEngine 입력 탭 → 44.1kHz mono Int16 PCM 으로 변환해 콜백. 인터럽션·라우트 변경 알림을 상태 입력으로 전달한다.
final class AudioCaptureEngine {
    static let sampleRate: Double = 44_100

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: AudioCaptureEngine.sampleRate, channels: 1, interleaved: true)!
    private var observers: [NSObjectProtocol] = []
    private var running = false
    // 인터럽션 began 후 ended 미수신 대비 — 10초 넘으면 엔진 재기동 + interruptionEnded 합성
    private var watchdog = InterruptionWatchdog(timeout: 10)
    private var watchdogTimer: Timer?
    private let watchdogLock = NSLock()

    var onSamples: (([Int16]) -> Void)?
    var onInput: ((RecorderInput) -> Void)?
    var onRouteChange: (() -> Void)?
    var onFailure: ((String) -> Void)?

    func start() throws {
        guard !running else { return }
        try AudioSessionConfig.apply()
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        guard inFormat.sampleRate > 0, let conv = AVAudioConverter(from: inFormat, to: outFormat) else {
            throw NSError(domain: "AudioCaptureEngine", code: 1, userInfo: [NSLocalizedDescriptionKey: "입력 포맷 없음"])
        }
        converter = conv
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buf, _ in self?.handle(buf) }
        engine.prepare()
        try engine.start()
        running = true
        observe()
    }

    func stop() {
        guard running else { return }
        running = false
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        watchdogLock.lock(); watchdog.ended(); watchdogLock.unlock()
        stopWatchdogTimer()
    }

    /// 인터럽션 종료·라우트 변경 후 엔진 재기동
    /// 엔진이 가동 중이면 true. 멈춰 있으면 재기동을 시도하고 성공 여부를 돌려준다.
    @discardableResult
    func restartIfNeeded() -> Bool {
        guard running else { return false }
        if engine.isRunning { return true }
        do { try AudioSessionConfig.apply(); try engine.start(); return true } catch { onFailure?("엔진 재시작 실패"); return false }
    }

    /// 인터럽션 복귀 시도. 엔진 기동에 성공한 경우에만 interruptionEnded 를 합성한다(통화 중 등 정당한 인터럽션은 유지).
    /// - force: 포그라운드 복귀처럼 타임아웃을 기다리지 않고 즉시 시도
    private func recheck(force: Bool) {
        guard running else { return }
        watchdogLock.lock()
        let interrupted = watchdog.isInterrupted
        let due = interrupted && (force || watchdog.shouldAttempt(at: Date().timeIntervalSince1970))
        if due { watchdog.attempted(at: Date().timeIntervalSince1970) }
        watchdogLock.unlock()
        guard interrupted else { restartIfNeeded(); return }
        guard due else { return }
        if restartIfNeeded() {
            watchdogLock.lock(); watchdog.ended(); watchdogLock.unlock()
            stopWatchdogTimer()
            onInput?(.interruptionEnded)
        }
    }

    private func startWatchdogTimer() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.watchdogTimer == nil else { return }
            self.watchdogTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.recheck(force: false) }
        }
    }

    private func stopWatchdogTimer() {
        DispatchQueue.main.async { [weak self] in
            self?.watchdogTimer?.invalidate(); self?.watchdogTimer = nil
        }
    }

    private func handle(_ buf: AVAudioPCMBuffer) {
        guard let conv = converter else { return }
        let ratio = outFormat.sampleRate / buf.format.sampleRate
        let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio + 32)
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: cap) else { return }
        var supplied = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return buf
        }
        guard err == nil, out.frameLength > 0, let p = out.int16ChannelData?[0] else { return }
        onSamples?(Array(UnsafeBufferPointer(start: p, count: Int(out.frameLength))))
    }

    private func observe() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] n in
            guard let self = self, let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let t = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if t == .began {
                self.watchdogLock.lock(); self.watchdog.began(at: Date().timeIntervalSince1970); self.watchdogLock.unlock()
                self.startWatchdogTimer()
                self.onInput?(.interruptionBegan)
            } else {
                self.watchdogLock.lock(); self.watchdog.ended(); self.watchdogLock.unlock()
                self.stopWatchdogTimer()
                self.restartIfNeeded()
                self.onInput?(.interruptionEnded)
            }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] _ in
            self?.onRouteChange?()
            self?.recheck(force: false)
        })
        // 앱 포그라운드 복귀: 인터럽션이 남아 있으면 즉시 복귀를 시도하고, 엔진이 멈췄으면 재기동한다.
        observers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.recheck(force: true)
        })
        observers.append(nc.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
            guard let self = self else { return }
            // 입력 포맷이 바뀌면 컨버터를 다시 만든다.
            let f = self.engine.inputNode.outputFormat(forBus: 0)
            if f.sampleRate > 0 { self.converter = AVAudioConverter(from: f, to: self.outFormat) }
            self.restartIfNeeded()
        })
    }
}
