import Foundation
import CoreBluetooth
import os

public enum BandUUIDs {
    // frontend/src/lib/eeg/bluetoothService.ts · 공식 SDK device.py 와 동일
    public static let eegService = CBUUID(string: "df7b5d95-3afe-00a1-084c-b50895ef4f95")
    public static let eegChar = CBUUID(string: "00ab4d15-66b4-0d8a-824f-8d6f8966c6e5")
    public static let ppgService = CBUUID(string: "1cc50ec0-6967-9d84-a243-c2267f924d1f")
    public static let ppgChar = CBUUID(string: "6c739642-23ba-818b-2045-bfe8970263f6")
    public static let accService = CBUUID(string: "75c276c3-8f97-20bc-a143-b354244886d4")
    public static let accChar = CBUUID(string: "d3d46a35-4394-e9aa-5a43-e7921120aaed")
    public static let batteryService = CBUUID(string: "180F")
    public static let batteryChar = CBUUID(string: "2A19")
    public static let services = [eegService, ppgService, accService, batteryService]
    public static let notifyChars = [eegChar, ppgChar, accChar]
    public static func sensor(for c: CBUUID) -> BandSensor? { c == eegChar ? .eeg : c == ppgChar ? .ppg : c == accChar ? .acc : nil }
}

public enum MonotonicClock {
    /// 절전 구간을 포함하는 단조 시계(µs). 벽시계와 분리한다.
    public static func nowUs() -> UInt64 { clock_gettime_nsec_np(CLOCK_MONOTONIC) / 1000 }
    public static func wallMs() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }
}

public struct RestoredPeripheral: Equatable {
    public let id: UUID, connected: Bool
    public let discoveredCharacteristics: [CBUUID], notifying: [CBUUID]
    public init(id: UUID, connected: Bool, discoveredCharacteristics: [CBUUID], notifying: [CBUUID]) {
        self.id = id; self.connected = connected; self.discoveredCharacteristics = discoveredCharacteristics; self.notifying = notifying
    }
}

/// willRestoreState 에서 무엇을 할지 결정하는 순수 함수. 기대한(저장해 둔) 밴드가 아니면 건드리지 않는다.
public struct RestorationPlan: Equatable {
    public enum Action: Equatable { case none, adopt(UUID), reconnect(UUID) }
    public let action: Action
    public let needNotify: [CBUUID]
    public static func make(restored: [RestoredPeripheral], expectedPeripheral: UUID?) -> RestorationPlan {
        guard let want = expectedPeripheral, let p = restored.first(where: { $0.id == want }) else { return RestorationPlan(action: .none, needNotify: []) }
        if !p.connected { return RestorationPlan(action: .reconnect(want), needNotify: []) }
        return RestorationPlan(action: .adopt(want), needNotify: BandUUIDs.notifyChars.filter { !p.notifying.contains($0) })
    }
}

public struct ReconnectBackoff {
    private var n = 0
    static let steps: [TimeInterval] = [1, 2, 4, 8, 15]
    public init() {}
    public mutating func next() -> TimeInterval { defer { n += 1 }; return Self.steps[min(n, Self.steps.count - 1)] }
    public mutating func reset() { n = 0 }
}

/// 연결할 기기 선택(순수). 저장 ID → 이미 연결된 같은 ID → (ID 없음) 이미 연결된 첫 밴드. 없으면 nil = 스캔.
public enum PeripheralPick {
    public static func choose(expected: UUID?, known: UUID?, connected: [UUID]) -> UUID? {
        if let k = known { return k }
        if let e = expected { return connected.contains(e) ? e : nil }
        return connected.first
    }
}

/// SDD-293: 대기실에서 보류(hold)로 쥔 링크를 측정 시작 때 어떻게 다룰지(순수).
/// 재연결(끊고 다시 붙임)이 지연의 원인이었다 — 보류 링크가 준비됐고 같은 기기면 재연결 없이 구독만 한다.
public enum HoldReuse {
    public enum Decision: Equatable { case fresh, joinPending, reuse }
    public static func decide(holding: Bool, holdReady: Bool, peripheralConnected: Bool, expected: UUID?, held: UUID?) -> Decision {
        guard holding else { return .fresh }
        if let e = expected, let h = held, e != h { return .fresh }
        if holdReady && peripheralConnected { return .reuse }
        return .joinPending
    }
}

/// ID 없는 스캔이 길어질 때 이미 연결된 밴드를 주기적으로 다시 확인하는 타이머. start 는 이전 예약을 대체하고 cancel 은 멱등이다.
public final class ScanRecheck {
    public static let interval: TimeInterval = 5
    private let scheduler: Scheduler
    private var timer: Cancellable?
    public init(scheduler: Scheduler) { self.scheduler = scheduler }
    public var isArmed: Bool { timer != nil }
    public func start(_ tick: @escaping () -> Void) {
        timer?.cancel()
        timer = scheduler.schedule(after: Self.interval) { [weak self] in self?.timer = nil; tick() }
    }
    public func cancel() { timer?.cancel(); timer = nil }
}

/// 종료 시 연결을 끊을 기기 집합(순수). 보유한 peripheral 이 없거나 복원/인계로 반영되지 않았어도 이미 연결된 밴드를 놓치지 않는다. 중복 제거, 순서 유지.
public enum BandReleasePlan {
    public static func targets(current: UUID?, connected: [UUID]) -> [UUID] {
        var out: [UUID] = []
        for id in ([current].compactMap { $0 } + connected) where !out.contains(id) { out.append(id) }
        return out
    }
}

/// SDD-301: BandLink(CBCentralManager)는 앱 전체에서 하나만 만든다. manager 가 이미 있으면 다시 만들지 않는다.
public enum ManagerBootstrapPolicy {
    public static func shouldCreate(nativeEnabled: Bool, hasManager: Bool) -> Bool { nativeEnabled && !hasManager }
}

public enum BandLinkState: String { case idle, scanning, connecting, discovering, subscribed, reconnecting, blocked }

public protocol BandLinkDelegate: AnyObject {
    func bandLink(didReceive sensor: BandSensor, data: Data, monotonicUs: UInt64)
    func bandLink(didChange state: BandLinkState, reason: String?)
    func bandLink(didReadBattery pct: Int)
    func bandLink(didSelect peripheral: UUID)
}

/// CoreBluetooth 전용 serial queue + restoration identifier. 모든 delegate 콜백은 `queue` 위에서 호출된다.
/// BLE notify 콜백은 시각 기록 후 곧바로 delegate 로 넘기고, journal/DSP 는 delegate(Manager)가 같은 queue 에서 짧게 처리한다.
public final class BandLink: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private static let log = Logger(subsystem: "com.looxidlabs.mindbreeze2", category: "BandLink")
    public static let restoreIdentifier = "com.looxidlabs.mindbreeze2.band.central"
    public let queue: DispatchQueue
    public weak var delegate: BandLinkDelegate?
    public private(set) var state: BandLinkState = .idle
    public private(set) var restoredByOS = false

    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var expected: UUID?
    private var wantConnected = false
    private var backoff = ReconnectBackoff()
    private var scheduler: Scheduler
    private var retry: Cancellable?
    private lazy var scanRecheck = ScanRecheck(scheduler: scheduler)
    // SDD-293: 보류 모드 — 연결·서비스/특성 발견까지만 하고 notify 구독은 하지 않는다(connect 가 오면 재연결 없이 구독).
    private var holding = false
    public private(set) var holdReady = false
    public var onHoldReady: (() -> Void)?

    /// 앱 시작(didFinishLaunching)에서 WebView 보다 먼저 만든다. 만들기만 해도 OS 복원 콜백이 오게 된다.
    public init(queue: DispatchQueue, expectedPeripheral: UUID?, delegate: BandLinkDelegate? = nil) {
        self.queue = queue; self.expected = expectedPeripheral; self.delegate = delegate
        self.scheduler = DispatchScheduler(queue: queue)
        super.init()
        central = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionRestoreIdentifierKey: Self.restoreIdentifier, CBCentralManagerOptionShowPowerAlertKey: false])
        Self.log.info("BandBLE 생성 id=\(UInt(bitPattern: ObjectIdentifier(self).hashValue) % 100000, privacy: .public) restoreId=\(Self.restoreIdentifier, privacy: .public)")
    }

    private func set(_ s: BandLinkState, _ reason: String? = nil) { state = s; delegate?.bandLink(didChange: s, reason: reason) }

    /// 보류 연결: JS 가 쥔 링크를 먼저 집어 연결·발견까지 마친다. 이후 JS 가 자기 연결을 놓아도 시스템 링크는 유지된다.
    public func hold(expectedPeripheral: UUID?) {
        queue.async { [self] in
            if holding && holdReady { onHoldReady?(); return }
            expected = expectedPeripheral ?? expected; wantConnected = true; holding = true; holdReady = false; backoff.reset()
            attempt()
        }
    }

    public func connect(expectedPeripheral: UUID?) {
        queue.async { [self] in
            if let p = peripheral {
                switch HoldReuse.decide(holding: holding, holdReady: holdReady, peripheralConnected: p.state == .connected, expected: expectedPeripheral, held: p.identifier) {
                case .reuse:
                    holding = false; holdReady = false; wantConnected = true; backoff.reset()
                    subscribe(p); return                    // 재연결 0회: 이미 연결·발견된 링크에 구독만
                case .joinPending:
                    holding = false; wantConnected = true; return   // 진행 중인 보류 연결이 끝나면 곧바로 구독한다
                case .fresh: break
                }
            }
            holding = false; holdReady = false
            expected = expectedPeripheral; wantConnected = true; backoff.reset()
            attempt()
        }
    }
    public func disconnect() {
        queue.async { [self] in
            holding = false; holdReady = false
            wantConnected = false; retry?.cancel(); retry = nil; scanRecheck.cancel()
            if central.isScanning { central.stopScan() }
            // peripheral 이 nil 이거나 인계/복원으로 반영되지 않았어도 연결된 밴드를 찾아 끊는다(SDD-298).
            let connected = central.state == .poweredOn ? central.retrieveConnectedPeripherals(withServices: [BandUUIDs.eegService]) : []
            let ids = BandReleasePlan.targets(current: peripheral?.identifier, connected: connected.map { $0.identifier })
            var cancelled = 0
            for id in ids {
                if let p = (peripheral?.identifier == id ? peripheral : nil) ?? connected.first(where: { $0.identifier == id }) {
                    central.cancelPeripheralConnection(p); cancelled += 1
                }
            }
            Self.log.info("밴드 해제 요청 targets=\(ids.count, privacy: .public) cancelled=\(cancelled, privacy: .public) hadPeripheral=\(self.peripheral != nil, privacy: .public)")
            peripheral = nil
            set(.idle)
        }
    }

    private func attempt() {
        guard wantConnected, central.state == .poweredOn else { return }
        // 저장된 ID 가 없어도(JS 연결 해제 직후 캐시가 비는 경우) 이미 연결돼 있는 밴드를 먼저 집는다.
        // 연결된 기기는 광고하지 않아 스캔으로는 영영 안 보인다 — 스캔만 하면 '연결하는 중' 에서 멈춘다.
        let known = expected.flatMap { central.retrievePeripherals(withIdentifiers: [$0]).first }
        let connected = central.retrieveConnectedPeripherals(withServices: [BandUUIDs.eegService])
        if let pick = PeripheralPick.choose(expected: expected, known: known?.identifier, connected: connected.map { $0.identifier }),
           let p = known ?? connected.first(where: { $0.identifier == pick }) {
            scanRecheck.cancel()
            if central.isScanning { central.stopScan() }
            peripheral = p; p.delegate = self
            set(.connecting)
            central.connect(p, options: nil)       // 타임아웃 없는 pending connect — 범위 안에 들어오면 OS 가 깨워 준다
        } else {
            set(.scanning)
            central.scanForPeripherals(withServices: [BandUUIDs.eegService], options: nil)
            // 연결된 밴드는 광고하지 않아 스캔에 안 보인다 — 스캔이 계속되는 동안 5초마다 연결 목록을 다시 확인한다
            scanRecheck.start { [weak self] in
                guard let self, self.wantConnected, self.state == .scanning else { return }
                self.attempt()
            }
        }
    }

    private func scheduleRetry(_ reason: String) {
        guard wantConnected else { return }
        scanRecheck.cancel()
        holdReady = false
        set(.reconnecting, reason)
        retry?.cancel()
        retry = scheduler.schedule(after: backoff.next()) { [weak self] in self?.attempt() }
    }

    // MARK: CBCentralManagerDelegate

    public func centralManagerDidUpdateState(_ c: CBCentralManager) {
        Self.log.info("central state=\(c.state.rawValue, privacy: .public) id=\(UInt(bitPattern: ObjectIdentifier(self).hashValue) % 100000, privacy: .public)")
        switch c.state {
        case .poweredOn: if wantConnected { attempt() }
        case .unauthorized, .unsupported: set(.blocked, "bluetooth_\(c.state == .unauthorized ? "unauthorized" : "unsupported")")
        case .poweredOff: if wantConnected { set(.reconnecting, "bluetooth_off") }
        default: break
        }
    }

    public func centralManager(_ c: CBCentralManager, willRestoreState dict: [String: Any]) {
        restoredByOS = true
        let ps = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral]) ?? []
        let snapshot = ps.map { p in
            RestoredPeripheral(id: p.identifier, connected: p.state == .connected,
                               discoveredCharacteristics: (p.services ?? []).flatMap { $0.characteristics ?? [] }.map { $0.uuid },
                               notifying: (p.services ?? []).flatMap { $0.characteristics ?? [] }.filter { $0.isNotifying }.map { $0.uuid })
        }
        let plan = RestorationPlan.make(restored: snapshot, expectedPeripheral: expected)
        guard let p = ps.first(where: { $0.identifier == expected }) else { return }
        wantConnected = true
        peripheral = p; p.delegate = self
        switch plan.action {
        case .adopt:
            set(.discovering)
            if (p.services ?? []).isEmpty { p.discoverServices(BandUUIDs.services) }
            else { subscribe(p) }
        case .reconnect: set(.connecting); c.connect(p, options: nil)
        case .none: break
        }
    }

    public func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        if let id = expected, p.identifier != id { return }
        scanRecheck.cancel(); c.stopScan(); peripheral = p; p.delegate = self; set(.connecting); c.connect(p, options: nil)
    }
    public func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        backoff.reset(); expected = p.identifier; delegate?.bandLink(didSelect: p.identifier)
        set(.discovering); p.discoverServices(BandUUIDs.services)
    }
    public func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { scheduleRetry("connect_failed") }
    public func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) { scheduleRetry("ble_disconnect") }

    // MARK: CBPeripheralDelegate

    public func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else { scheduleRetry("discover_failed"); return }
        for s in p.services ?? [] { p.discoverCharacteristics(nil, for: s) }
    }
    public func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        guard error == nil else { return }
        subscribe(p)
    }
    private func subscribe(_ p: CBPeripheral) {
        let chars = (p.services ?? []).flatMap { $0.characteristics ?? [] }
        if holding {
            // 보류: 특성 발견이 끝났을 때만 준비 완료로 알린다(구독·배터리 읽기는 connect 때)
            if BandUUIDs.notifyChars.allSatisfy({ u in chars.contains { $0.uuid == u } }), !holdReady { holdReady = true; onHoldReady?() }
            return
        }
        for c in chars where BandUUIDs.notifyChars.contains(c.uuid) && !c.isNotifying { p.setNotifyValue(true, for: c) }
        for c in chars where c.uuid == BandUUIDs.batteryChar { p.readValue(for: c) }
        if BandUUIDs.notifyChars.allSatisfy({ u in chars.contains { $0.uuid == u } }) { set(.subscribed) }
    }
    public func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        let t = MonotonicClock.nowUs()                       // 가장 먼저 도착 시각 기록
        guard error == nil, let d = c.value else { return }
        if c.uuid == BandUUIDs.batteryChar, let b = d.first { delegate?.bandLink(didReadBattery: Int(b)); return }
        if let s = BandUUIDs.sensor(for: c.uuid) { delegate?.bandLink(didReceive: s, data: d, monotonicUs: t) }
    }
}
