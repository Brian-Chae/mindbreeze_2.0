import Foundation
import CoreBluetooth

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

    /// 앱 시작(didFinishLaunching)에서 WebView 보다 먼저 만든다. 만들기만 해도 OS 복원 콜백이 오게 된다.
    public init(queue: DispatchQueue, expectedPeripheral: UUID?, delegate: BandLinkDelegate? = nil) {
        self.queue = queue; self.expected = expectedPeripheral; self.delegate = delegate
        self.scheduler = DispatchScheduler(queue: queue)
        super.init()
        central = CBCentralManager(delegate: self, queue: queue, options: [CBCentralManagerOptionRestoreIdentifierKey: Self.restoreIdentifier, CBCentralManagerOptionShowPowerAlertKey: false])
    }

    private func set(_ s: BandLinkState, _ reason: String? = nil) { state = s; delegate?.bandLink(didChange: s, reason: reason) }

    public func connect(expectedPeripheral: UUID?) {
        queue.async { [self] in
            expected = expectedPeripheral; wantConnected = true; backoff.reset()
            attempt()
        }
    }
    public func disconnect() {
        queue.async { [self] in
            wantConnected = false; retry?.cancel(); retry = nil
            if central.isScanning { central.stopScan() }
            if let p = peripheral { central.cancelPeripheralConnection(p) }
            set(.idle)
        }
    }

    private func attempt() {
        guard wantConnected, central.state == .poweredOn else { return }
        if let id = expected, let p = central.retrievePeripherals(withIdentifiers: [id]).first ?? central.retrieveConnectedPeripherals(withServices: [BandUUIDs.eegService]).first(where: { $0.identifier == id }) {
            peripheral = p; p.delegate = self
            set(.connecting)
            central.connect(p, options: nil)       // 타임아웃 없는 pending connect — 범위 안에 들어오면 OS 가 깨워 준다
        } else {
            set(.scanning)
            central.scanForPeripherals(withServices: [BandUUIDs.eegService], options: nil)
        }
    }

    private func scheduleRetry(_ reason: String) {
        guard wantConnected else { return }
        set(.reconnecting, reason)
        retry?.cancel()
        retry = scheduler.schedule(after: backoff.next()) { [weak self] in self?.attempt() }
    }

    // MARK: CBCentralManagerDelegate

    public func centralManagerDidUpdateState(_ c: CBCentralManager) {
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
        c.stopScan(); peripheral = p; p.delegate = self; set(.connecting); c.connect(p, options: nil)
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
